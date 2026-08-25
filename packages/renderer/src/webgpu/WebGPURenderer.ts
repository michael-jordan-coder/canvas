import { DEFAULT_PAGE_BACKGROUND, type SceneDocument, type TextLayoutCache } from '@canvas/document'
import { clipMatrix, pixelsToClip, type Viewport } from '../camera.js'
import type { Renderer, RendererInit, RendererStats, ViewState } from '../Renderer.js'
import { createGPUSurface, onDeviceLost, releaseGPUSurface, type GPUSurface } from './device.js'
import { MatrixUniform, createMatrixBindGroupLayout } from './MatrixUniform.js'
import {
  ClipRegions,
  createStorageBindGroup,
  createStorageBindGroupLayout,
} from './ClipRegions.js'
import { GradientRamps } from './GradientRamps.js'
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

/** The document owns the default, so the panel's swatch and this clear always agree. */
const BACKDROP: GPUColor = { ...DEFAULT_PAGE_BACKGROUND }

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
  #ramps: GradientRamps
  #atlas: GlyphAtlas
  #shapes: ShapeInstances
  #overlay: OverlayInstances
  #shapePipeline: GPURenderPipeline
  #overlayPipeline: GPURenderPipeline

  #storageLayout: GPUBindGroupLayout
  /**
   * The group naming the clip and ramp buffers, rebuilt when either one has grown into a
   * new buffer. Memoised on the buffers' identity rather than owned by either table,
   * because both live in the one group and each grows on its own schedule.
   */
  #storage: { group: GPUBindGroup; clips: GPUBuffer; ramps: GPUBuffer } | null = null

  /** CSS pixels. The matrix works in these, the backing store works in device pixels. */
  #viewport: Viewport = { width: 1, height: 1 }
  #destroyed = false

  constructor(
    surface: GPUSurface,
    canvas: HTMLCanvasElement,
    document: SceneDocument,
    atlas: GlyphAtlasSource,
    layouts: TextLayoutCache,
  ) {
    this.#surface = surface
    this.#canvas = canvas
    this.#document = document

    const layout = createMatrixBindGroupLayout(surface.device)
    this.#worldToClip = new MatrixUniform(surface.device, layout, 'world to clip')
    this.#pixelsToClip = new MatrixUniform(surface.device, layout, 'pixels to clip')

    this.#storageLayout = createStorageBindGroupLayout(surface.device)
    this.#clips = new ClipRegions(surface.device)
    this.#ramps = new GradientRamps(surface.device)

    const atlasLayout = createAtlasBindGroupLayout(surface.device)
    this.#atlas = new GlyphAtlas(surface.device, atlasLayout, atlas)

    this.#shapes = new ShapeInstances(
      surface.device,
      this.#clips,
      this.#ramps,
      this.#atlas.metrics,
      layouts,
    )
    this.#overlay = new OverlayInstances(surface.device, this.#atlas.metrics, layouts)

    // Built once at startup. Compiling a pipeline mid frame is the classic way to produce
    // a stutter that only shows up the first time a user draws something.
    this.#shapePipeline = createShapePipeline(
      surface.device,
      surface.format,
      layout,
      this.#storageLayout,
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

  /**
   * The page's own colour if it has one, the shared backdrop if not. Read from the
   * document per frame like everything else drawn: alpha is pinned to 1 because the
   * surface is opaque and there is nothing behind the page to blend with.
   */
  #backgroundColor(): GPUColor {
    const root = this.#document.getNode(this.#document.rootId)
    const color = root?.type === 'page' ? root.backgroundColor : undefined
    return color ? { r: color.r, g: color.g, b: color.b, a: 1 } : BACKDROP
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
      view.hover,
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
          clearValue: this.#backgroundColor(),
        },
      ],
    })

    const shapes = this.#shapes.buffer
    const storage = this.#storageBindGroup()
    if (shapes && storage && this.#shapes.count > 0) {
      pass.setPipeline(this.#shapePipeline)
      pass.setBindGroup(0, this.#worldToClip.bindGroup)
      pass.setBindGroup(1, storage)
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

  #storageBindGroup(): GPUBindGroup | null {
    const clips = this.#clips.buffer
    const ramps = this.#ramps.buffer
    if (!clips || !ramps) return null
    if (!this.#storage || this.#storage.clips !== clips || this.#storage.ramps !== ramps) {
      this.#storage = {
        group: createStorageBindGroup(this.#surface.device, this.#storageLayout, clips, ramps),
        clips,
        ramps,
      }
    }
    return this.#storage.group
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
    this.#ramps.destroy()
    this.#storage = null
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
  return new WebGPURenderer(surface, init.canvas, init.document, await pending, init.layouts)
}
