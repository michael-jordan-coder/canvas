import type { SceneDocument } from '@figma-canvas/document'
import { clipMatrix, pixelsToClip, type Viewport } from '../camera.js'
import type { Renderer, RendererInit, RendererStats, ViewState } from '../Renderer.js'
import { createGPUSurface, onDeviceLost, releaseGPUSurface, type GPUSurface } from './device.js'
import { MatrixUniform, createMatrixBindGroupLayout } from './MatrixUniform.js'
import { ClipRegions, createClipBindGroupLayout } from './ClipRegions.js'
import {
  GlyphAtlas,
  createAtlasBindGroupLayout,
  loadGlyphAtlas,
  type GlyphAtlasSource,
} from './GlyphAtlas.js'
import { ShapeInstances } from './ShapeInstances.js'
import { OverlayInstances } from './OverlayInstances.js'
import { createShapePipeline } from './pipelines/shape.js'
import { createOverlayPipeline } from './pipelines/overlay.js'

/** Mid grey, matching --backdrop. Written in the same 0..1 form the GPU stores. */
const BACKDROP: GPUColor = { r: 138 / 255, g: 138 / 255, b: 138 / 255, a: 1 }

/**
 * Two passes over the same surface: the document in world space, then the selection overlay
 * in screen space. They differ only in which matrix they are bound to.
 */
class WebGPURenderer implements Renderer {
  #surface: GPUSurface
  #canvas: HTMLCanvasElement
  #document: SceneDocument

  #worldToClip: MatrixUniform
  #pixelsToClip: MatrixUniform

  #clips: ClipRegions
  #atlas: GlyphAtlas
  #shapes: ShapeInstances
  #overlay: OverlayInstances
  #shapePipeline: GPURenderPipeline
  #overlayPipeline: GPURenderPipeline

  /** CSS pixels. The matrix works in these, the backing store works in device pixels. */
  #viewport: Viewport = { width: 1, height: 1 }
  #destroyed = false

  constructor(
    surface: GPUSurface,
    canvas: HTMLCanvasElement,
    document: SceneDocument,
    atlas: GlyphAtlasSource,
  ) {
    this.#surface = surface
    this.#canvas = canvas
    this.#document = document

    const layout = createMatrixBindGroupLayout(surface.device)
    this.#worldToClip = new MatrixUniform(surface.device, layout, 'world to clip')
    this.#pixelsToClip = new MatrixUniform(surface.device, layout, 'pixels to clip')

    const clipLayout = createClipBindGroupLayout(surface.device)
    this.#clips = new ClipRegions(surface.device, clipLayout)

    const atlasLayout = createAtlasBindGroupLayout(surface.device)
    this.#atlas = new GlyphAtlas(surface.device, atlasLayout, atlas)

    this.#shapes = new ShapeInstances(surface.device, this.#clips, this.#atlas.metrics)
    this.#overlay = new OverlayInstances(surface.device, this.#atlas.metrics)

    // Built once at startup. Compiling a pipeline mid frame is the classic way to produce
    // a stutter that only shows up the first time a user draws something.
    this.#shapePipeline = createShapePipeline(
      surface.device,
      surface.format,
      layout,
      clipLayout,
      atlasLayout,
    )
    this.#overlayPipeline = createOverlayPipeline(surface.device, surface.format, layout)
  }

  resize(viewport: Viewport, dpr: number): void {
    if (this.#destroyed) return
    this.#viewport = viewport
    // The renderer owns the backing store. The host reports CSS pixels, the device decides
    // how many real ones that is, clamped so a huge window on a 3x display cannot ask for a
    // texture the GPU refuses to allocate.
    const max = this.#surface.device.limits.maxTextureDimension2D
    const width = Math.max(1, Math.min(max, Math.round(viewport.width * dpr)))
    const height = Math.max(1, Math.min(max, Math.round(viewport.height * dpr)))
    if (this.#canvas.width === width && this.#canvas.height === height) return
    this.#canvas.width = width
    this.#canvas.height = height
  }

  render(view: ViewState): void {
    if (this.#destroyed) return
    const { device, context } = this.#surface

    // One small write per frame moves the whole view. No geometry is touched by panning.
    this.#worldToClip.update(clipMatrix(view.camera, this.#viewport))
    this.#pixelsToClip.update(pixelsToClip(this.#viewport))

    // Returns immediately unless the document changed or the view left the built region.
    this.#shapes.sync(this.#document, view.camera, this.#viewport)
    // Always rebuilt: it is expressed in screen pixels, so the camera moving changes it.
    this.#overlay.sync(
      this.#document,
      view.selection,
      view.camera,
      this.#viewport,
      view.marquee,
      view.editing,
    )

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          // 'clear' rather than 'load' because the whole surface is redrawn every frame.
          // Loading the previous contents would cost bandwidth for pixels about to be
          // overwritten, and on tiled GPUs that is the expensive kind of waste.
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: BACKDROP,
        },
      ],
    })

    const shapes = this.#shapes.buffer
    const clips = this.#clips.bindGroup
    if (shapes && clips && this.#shapes.count > 0) {
      pass.setPipeline(this.#shapePipeline)
      pass.setBindGroup(0, this.#worldToClip.bindGroup)
      pass.setBindGroup(1, clips)
      pass.setBindGroup(2, this.#atlas.bindGroup)
      pass.setVertexBuffer(0, shapes)
      // Four corners, one instance per shape and one per glyph. The whole document, text
      // included, in a single call.
      pass.draw(4, this.#shapes.count)
    }

    // Second, so it lands on top. There is no depth buffer to sort them, and none is wanted.
    const overlay = this.#overlay.buffer
    if (overlay && this.#overlay.count > 0) {
      pass.setPipeline(this.#overlayPipeline)
      pass.setBindGroup(0, this.#pixelsToClip.bindGroup)
      pass.setVertexBuffer(0, overlay)
      pass.draw(4, this.#overlay.count)
    }

    pass.end()

    device.queue.submit([encoder.finish()])
  }

  /** What the last frame actually submitted. Read by the editor's performance readout. */
  get stats(): RendererStats {
    return { instances: this.#shapes.count, culled: this.#shapes.culled }
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#worldToClip.destroy()
    this.#pixelsToClip.destroy()
    this.#shapes.destroy()
    this.#clips.destroy()
    this.#atlas.destroy()
    this.#overlay.destroy()
    releaseGPUSurface(this.#surface)
  }
}

export interface CreateRendererOptions {
  /** Called if the GPU device dies after startup, which no amount of correct code prevents. */
  onLost?: (reason: string) => void
}

export async function createWebGPURenderer(
  init: RendererInit,
  options: CreateRendererOptions = {},
): Promise<Renderer> {
  // Started before the device is asked for, because the atlas is a fetch and a decode and
  // needs no device at all. Awaiting them in turn would add the whole download to the time
  // before the first frame, for no reason beyond the order the lines happened to be written.
  const pending = loadGlyphAtlas()
  const surface = await createGPUSurface(init.canvas)
  if (options.onLost) onDeviceLost(surface.device, options.onLost)
  // Still awaited before the renderer exists, so the first frame already has its glyphs. A
  // placeholder texture swapped in later would flash the document in blank boxes.
  return new WebGPURenderer(surface, init.canvas, init.document, await pending)
}
