import { describe, expect, it } from 'vitest'

import type { FontMetrics } from '@figma-canvas/document'

import { GlyphAtlas, createAtlasBindGroupLayout } from './GlyphAtlas.js'
import { createStubDevice } from './testing/stubDevice.js'

/*
 * The atlas has no geometry to get wrong, but it has two settings that fail quietly rather
 * than loudly, and both of them look like a rendering problem rather than a configuration
 * one. Neither is visible in a screenshot until you know what you are looking for.
 */

const METRICS: FontMetrics = {
  lineHeight: 1.25,
  ascender: -1,
  descender: 0.25,
  pxRange: 4,
  fallback: 0x3f,
  glyphs: new Map(),
}

function build() {
  const stubbed = createStubDevice()
  const layout = createAtlasBindGroupLayout(stubbed.device)
  const bitmap = { width: 512, height: 512 } as ImageBitmap
  const atlas = new GlyphAtlas(stubbed.device, layout, { bitmap, metrics: METRICS })
  return { stubbed, atlas }
}

describe('GlyphAtlas', () => {
  it('stores the field as plain unorm, not srgb', () => {
    // The channels are distances, not colour. A transfer curve applied to them bends every
    // edge in the document by a little, which reads as the text being slightly wrong weight.
    const [descriptor] = build().stubbed.textures()
    expect(descriptor?.format).toBe('rgba8unorm')
  })

  it('asks for the usage copyExternalImageToTexture needs', () => {
    // Without RENDER_ATTACHMENT the upload throws, and the message names the usage rather
    // than the copy, so it reads as an unrelated mistake.
    const [descriptor] = build().stubbed.textures()
    const usage = descriptor?.usage ?? 0
    expect(usage & GPUTextureUsage.TEXTURE_BINDING).toBeTruthy()
    expect(usage & GPUTextureUsage.COPY_DST).toBeTruthy()
    expect(usage & GPUTextureUsage.RENDER_ATTACHMENT).toBeTruthy()
  })

  it('sizes the texture to the decoded image', () => {
    const [descriptor] = build().stubbed.textures()
    expect(descriptor?.size).toEqual([512, 512])
  })

  it('carries the metrics that were baked with it', () => {
    expect(build().atlas.metrics).toBe(METRICS)
  })
})
