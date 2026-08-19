import type { Rect } from '../math.js'

/**
 * Everything needed to lay text out, as plain numbers.
 *
 * This package compiles without DOM on purpose, so it cannot measure a string with a canvas.
 * It does not need to: a baked glyph atlas already ships its advances and line metrics as
 * data, and that is the whole of what layout reads. The renderer owns the atlas and hands
 * this table in, which keeps the dependency pointing one way and keeps layout pure.
 *
 * One convention runs through every number here: **y grows downward and the origin is the
 * pen position on the baseline**. That is why `ascender` is negative. It matches the scene's
 * own y-down space and the atlas as it is baked (`-yorigin top`), so nothing in the pipeline
 * has to flip a sign.
 */
export interface FontMetrics {
  /** Baseline to baseline, in em. */
  readonly lineHeight: number
  /** Top of the line box, relative to the baseline. Negative, because up is negative. */
  readonly ascender: number
  /** Bottom of the line box, relative to the baseline. Positive. */
  readonly descender: number
  /** Width of the atlas distance field, in atlas pixels. The shader needs it to size coverage. */
  readonly pxRange: number
  /** By Unicode code point. */
  readonly glyphs: ReadonlyMap<number, GlyphMetrics>
  /** Stands in for any code point the atlas does not carry, so a gap is visible rather than blank. */
  readonly fallback: number
}

export interface GlyphMetrics {
  /** How far the pen moves after drawing this glyph, in em. */
  readonly advance: number
  /**
   * Null for whitespace, which advances the pen and draws nothing. Position and image are one
   * field rather than two nullable ones, because a glyph either has both or has neither.
   */
  readonly quad: GlyphQuad | null
}

export interface GlyphQuad {
  /** Where the glyph sits relative to the pen origin, in em. */
  readonly plane: Rect
  /** Where its image sits in the atlas, in 0..1 texture coordinates. */
  readonly uv: Rect
}

/** The glyph to draw for a code point the atlas does not carry. */
export function glyphFor(metrics: FontMetrics, code: number): GlyphMetrics | undefined {
  return metrics.glyphs.get(code) ?? metrics.glyphs.get(metrics.fallback)
}
