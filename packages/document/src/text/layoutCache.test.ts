import { beforeEach, describe, expect, it } from 'vitest'

import { createText, type TextNode } from '../node.js'
import { measureTextNode } from './layout.js'
import { TextLayoutCache } from './layoutCache.js'
import type { FontMetrics, GlyphMetrics } from './metrics.js'

/** The same made up font the layout tests use: every letter half an em, a space a quarter. */
function glyph(advance: number, drawn = true): GlyphMetrics {
  return {
    advance,
    quad: drawn
      ? { plane: { x: 0, y: -0.7, width: 0.5, height: 0.75 }, uv: { x: 0, y: 0, width: 0.1, height: 0.1 } }
      : null,
  }
}

const METRICS: FontMetrics = {
  lineHeight: 1.25,
  ascender: -1,
  descender: 0.25,
  pxRange: 4,
  fallback: 0x3f,
  glyphs: new Map<number, GlyphMetrics>([
    [0x20, glyph(0.25, false)],
    [0x3f, glyph(0.5)],
    [0x61, glyph(0.5)],
    [0x62, glyph(0.5)],
  ]),
}

/** A second font, identical in every number. Only its identity differs. */
const OTHER_METRICS: FontMetrics = { ...METRICS }

const text = (init: Partial<TextNode> = {}): TextNode =>
  createText({ characters: 'aa bb', fontSize: 20, ...init })

let cache: TextLayoutCache
let node: TextNode

beforeEach(() => {
  cache = new TextLayoutCache()
  node = text()
})

describe('TextLayoutCache', () => {
  it('returns the very same layout when nothing about the node changed', () => {
    // Identity rather than equality: a fresh object would mean it laid the text out again.
    expect(cache.layoutFor(node, METRICS)).toBe(cache.layoutFor(node, METRICS))
  })

  it.each([
    ['the characters', { characters: 'aa bc' }],
    ['the font size', { fontSize: 21 }],
  ])('lays out again when %s changed', (_what, changes) => {
    const before = cache.layoutFor(node, METRICS)
    expect(cache.layoutFor({ ...node, ...changes }, METRICS)).not.toBe(before)
  })

  it('lays out again when a fixed width box is dragged to a new width', () => {
    const fixed = text({ autoWidth: false, size: { width: 40, height: 0 } })
    const before = cache.layoutFor(fixed, METRICS)
    const wider = { ...fixed, size: { width: 80, height: 0 } }
    expect(cache.layoutFor(wider, METRICS)).not.toBe(before)
  })

  it('ignores a width change on an auto width box, which does not wrap to it', () => {
    const before = cache.layoutFor(node, METRICS)
    const resized = { ...node, size: { width: 999, height: 0 } }
    expect(cache.layoutFor(resized, METRICS)).toBe(before)
  })

  it('lays out again when the font itself changed', () => {
    const before = cache.layoutFor(node, METRICS)
    expect(cache.layoutFor(node, OTHER_METRICS)).not.toBe(before)
  })

  it('keeps one node separate from another', () => {
    const other = text({ characters: 'aa bb' })
    expect(cache.layoutFor(other, METRICS)).not.toBe(cache.layoutFor(node, METRICS))
  })

  it('survives one sweep, so a read between two rebuilds is still free', () => {
    const before = cache.layoutFor(node, METRICS)
    cache.sweep()
    expect(cache.layoutFor(node, METRICS)).toBe(before)
  })

  it('drops a node nothing has asked about for two sweeps', () => {
    const before = cache.layoutFor(node, METRICS)
    cache.sweep()
    cache.sweep()
    expect(cache.layoutFor(node, METRICS)).not.toBe(before)
  })

  it('promotes on a read, so a node still in use is never dropped', () => {
    const before = cache.layoutFor(node, METRICS)
    for (let i = 0; i < 5; i += 1) {
      cache.sweep()
      // What the renderer does every rebuild: sweep, then visit the node.
      expect(cache.layoutFor(node, METRICS)).toBe(before)
    }
  })
})

describe('TextLayoutCache.measure', () => {
  it('agrees with measuring the node directly', () => {
    expect(cache.measure(node, METRICS)).toEqual(measureTextNode(node, METRICS))
  })

  it('keeps the width a fixed box was dragged to and measures only its height', () => {
    const fixed = text({ autoWidth: false, size: { width: 30, height: 0 } })
    expect(cache.measure(fixed, METRICS)).toEqual({ width: 30, height: 50 })
  })

  /*
   * The reason `updateText` measures through the cache. A keystroke measures the text it is
   * about to write, and the frame that follows packs the glyphs and places the caret from
   * that same layout instead of building it twice more.
   */
  it('warms the entry the next layout reads', () => {
    const typed = { ...node, characters: 'aa bbb' }
    cache.measure(typed, METRICS)
    const packed = cache.layoutFor(typed, METRICS)
    expect(cache.layoutFor(typed, METRICS)).toBe(packed)
  })
})
