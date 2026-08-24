import { describe, expect, it } from 'vitest'

import { glyphFor } from '@canvas/document'

import atlas from './inter-regular.json'
import { InvalidAtlasError, parseAtlasMetrics } from './metrics.js'

const A = 0x41
const G = 0x67
const X = 0x78
const SPACE = 0x20
const QUESTION = 0x3f

/** A minimal well formed file, so a test can break one field at a time. */
function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    atlas: { type: 'msdf', distanceRange: 4, size: 48, width: 512, height: 512, yOrigin: 'top' },
    metrics: { emSize: 1, lineHeight: 1.21, ascender: -0.97, descender: 0.24 },
    glyphs: [
      { unicode: QUESTION, advance: 0.5, planeBounds: bounds(), atlasBounds: pixels() },
      { unicode: SPACE, advance: 0.28 },
    ],
    ...overrides,
  }
}

function bounds(): Record<string, number> {
  return { left: 0, top: -0.7, right: 0.5, bottom: 0.05 }
}

function pixels(): Record<string, number> {
  return { left: 0, top: 0, right: 32, bottom: 48 }
}

describe('parseAtlasMetrics, against the baked Inter atlas', () => {
  const metrics = parseAtlasMetrics(atlas)

  it('reads the line metrics in the y-down convention, so the ascender is negative', () => {
    expect(metrics.ascender).toBeLessThan(0)
    expect(metrics.descender).toBeGreaterThan(0)
    expect(metrics.lineHeight).toBeCloseTo(1.20996, 4)
  })

  it('spans exactly the line height from ascender to descender', () => {
    expect(metrics.descender - metrics.ascender).toBeCloseTo(metrics.lineHeight, 6)
  })

  it('carries the distance range the shader needs to size coverage', () => {
    expect(metrics.pxRange).toBe(4)
  })

  it('covers Latin-1 and the punctuation people actually type', () => {
    for (const code of [A, G, X, 0xe9, 0xff, 0x2019, 0x2014, 0x20ac]) {
      expect(metrics.glyphs.has(code)).toBe(true)
    }
  })

  it('gives whitespace an advance and no quad, since it moves the pen and draws nothing', () => {
    const space = metrics.glyphs.get(SPACE)
    expect(space?.advance).toBeGreaterThan(0)
    expect(space?.quad).toBeNull()
  })

  /*
   * The flip test. Bake without `-yorigin top` and every glyph still parses, still packs and
   * still draws, just upside down. What separates the two orientations is which letters reach
   * past the baseline: 'g' descends well below it and 'x' does not, so if that comparison
   * holds the atlas is the right way up.
   */
  it('places a descender below the baseline and a plain lowercase letter on it', () => {
    const g = metrics.glyphs.get(G)?.quad
    const x = metrics.glyphs.get(X)?.quad
    if (!g || !x) throw new Error('expected both glyphs to have a quad')

    expect(g.plane.y + g.plane.height).toBeGreaterThan(0.2)
    expect(x.plane.y + x.plane.height).toBeLessThan(0.1)
  })

  it('reaches higher for a capital than for a lowercase letter', () => {
    const a = metrics.glyphs.get(A)?.quad
    const x = metrics.glyphs.get(X)?.quad
    expect(a?.plane.y).toBeLessThan(x?.plane.y ?? 0)
  })

  it('normalises atlas pixels into 0..1 texture coordinates', () => {
    for (const [code, glyph] of metrics.glyphs) {
      if (!glyph.quad) continue
      const { x, y, width, height } = glyph.quad.uv
      const inside = x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1
      expect(inside, `U+${code.toString(16)} uv out of range`).toBe(true)
    }
  })

  it('falls back to a question mark, because Inter has no replacement character', () => {
    expect(metrics.glyphs.has(0xfffd)).toBe(false)
    expect(glyphFor(metrics, 0xfffd)).toBe(metrics.glyphs.get(QUESTION))
    expect(glyphFor(metrics, 0x4e2d)).toBe(metrics.glyphs.get(QUESTION))
  })

  it('returns the glyph itself when the atlas has it', () => {
    expect(glyphFor(metrics, A)).toBe(metrics.glyphs.get(A))
  })
})

describe('parseAtlasMetrics, refusing a bad bake', () => {
  it('refuses a bottom-up atlas, which would draw every glyph flipped', () => {
    const file = fixture({
      atlas: { type: 'msdf', distanceRange: 4, width: 512, height: 512, yOrigin: 'bottom' },
    })
    expect(() => parseAtlasMetrics(file)).toThrow(/yOrigin/)
  })

  it('refuses a single channel atlas, which has no median for the shader to take', () => {
    const file = fixture({
      atlas: { type: 'sdf', distanceRange: 4, width: 512, height: 512, yOrigin: 'top' },
    })
    expect(() => parseAtlasMetrics(file)).toThrow(/atlas.type/)
  })

  it('refuses an em size other than 1, which would scale the whole document', () => {
    const file = fixture({ metrics: { emSize: 2, lineHeight: 1.21, ascender: -1, descender: 0.2 } })
    expect(() => parseAtlasMetrics(file)).toThrow(/emSize/)
  })

  it('refuses a glyph with one of the two bounds, which is malformed rather than whitespace', () => {
    const file = fixture({ glyphs: [{ unicode: QUESTION, advance: 0.5, planeBounds: bounds() }] })
    expect(() => parseAtlasMetrics(file)).toThrow(/planeBounds and atlasBounds/)
  })

  it('refuses an atlas missing the fallback glyph', () => {
    const file = fixture({ glyphs: [{ unicode: SPACE, advance: 0.28 }] })
    expect(() => parseAtlasMetrics(file)).toThrow(InvalidAtlasError)
  })

  it('names the path that failed rather than saying invalid', () => {
    const file = fixture({ metrics: { emSize: 1, lineHeight: 'tall' } })
    expect(() => parseAtlasMetrics(file)).toThrow(/metrics\.lineHeight/)
  })
})
