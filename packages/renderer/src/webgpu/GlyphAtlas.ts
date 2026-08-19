import type { FontMetrics } from '@figma-canvas/document'

import atlasImage from '../font/inter-regular.png?url'
import atlasData from '../font/inter-regular.json?url'
import { parseAtlasMetrics } from '../font/metrics.js'

/** One layout for the glyph atlas, held by the shape pipeline alone. */
export function createAtlasBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'glyph atlas',
    entries: [
      {
        binding: 0,
        // Read per pixel, like the clip table. Which patch of the atlas a quad covers is
        // decided at the corners, but what the letter looks like is decided per fragment.
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' },
      },
    ],
  })
}

/** The decoded pair, before it has a device to live on. */
export interface GlyphAtlasSource {
  bitmap: ImageBitmap
  metrics: FontMetrics
}

let metrics: Promise<FontMetrics> | null = null

/**
 * The advances and line metrics of the baked font.
 *
 * Memoised and exported on its own because the editor needs it too: it measures a text node
 * on every keystroke to keep the node's cached size honest, and it positions the caret. Both
 * it and the renderer have to be looking at the same table, or the caret would sit beside
 * the text rather than in it, so there is one fetch and one parse for the whole app.
 */
export function loadFontMetrics(): Promise<FontMetrics> {
  metrics ??= fetch(atlasData)
    .then((response) => response.json() as Promise<unknown>)
    .then(parseAtlasMetrics)
  return metrics
}

/**
 * Fetches the baked atlas and its metrics.
 *
 * Separate from the class so the network half needs no device, which lets the renderer's
 * factory await it once and hand the result to a constructor that stays synchronous.
 */
export async function loadGlyphAtlas(): Promise<GlyphAtlasSource> {
  const [bitmap, parsed] = await Promise.all([
    fetch(atlasImage)
      .then((response) => response.blob())
      .then((blob) =>
        createImageBitmap(blob, {
          // Both of these default to letting the browser help, and both would corrupt the
          // image. The channels hold distances rather than colour, so a colour space
          // conversion bends every edge and premultiplying scales the field by its own alpha.
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        }),
      ),
    loadFontMetrics(),
  ])

  return { bitmap, metrics: parsed }
}

/**
 * The baked glyph atlas on the GPU: one texture, one sampler, one bind group.
 *
 * Uploaded once at startup and never touched again, which is what makes text cost the same
 * per frame as any other shape. Nothing here grows or rebinds, so unlike `ClipRegions` the
 * bind group is built in the constructor and stays valid for the renderer's whole life.
 */
export class GlyphAtlas {
  #texture: GPUTexture
  #bindGroup: GPUBindGroup
  #metrics: FontMetrics

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, source: GlyphAtlasSource) {
    const { bitmap, metrics } = source
    this.#metrics = metrics

    this.#texture = device.createTexture({
      label: 'glyph atlas',
      size: [bitmap.width, bitmap.height],
      // Emphatically not the srgb variant. A distance field is not a colour, and letting the
      // hardware apply a transfer curve to it distorts every edge in the document.
      format: 'rgba8unorm',
      // RENDER_ATTACHMENT is not because anything draws into it. copyExternalImageToTexture
      // requires it, which is easy to miss because the error names the usage, not the copy.
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })

    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: this.#texture }, [
      bitmap.width,
      bitmap.height,
    ])

    const sampler = device.createSampler({
      label: 'glyph atlas',
      // Linear, and no mipmaps at all. The field is resolution independent, so a smaller
      // glyph wants the same texels read more coarsely, not a blurrier pre-filtered copy.
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })

    this.#bindGroup = device.createBindGroup({
      label: 'glyph atlas',
      layout,
      entries: [
        { binding: 0, resource: this.#texture.createView() },
        { binding: 1, resource: sampler },
      ],
    })
  }

  get bindGroup(): GPUBindGroup {
    return this.#bindGroup
  }

  /** The advances and line metrics that go with this atlas, for laying text out. */
  get metrics(): FontMetrics {
    return this.#metrics
  }

  destroy(): void {
    this.#texture.destroy()
  }
}
