import type { FontMetrics, GlyphMetrics, GlyphQuad } from '@figma-canvas/document'

/**
 * Adapts the atlas generator's JSON into the table `packages/document` lays text out with.
 *
 * The file is our own build output rather than untrusted input, so this is not
 * `serialize.ts` grade validation. What it does check is the handful of bake settings that
 * would otherwise fail silently: a re-bake without `-yorigin top` renders every glyph upside
 * down, and a `-type sdf` atlas has no green or blue channel for the shader's median to read.
 * Both still produce a perfectly valid looking JSON file, which is exactly the class of bug
 * this project keeps finding.
 */

/**
 * Inter has no U+FFFD, so the replacement character cannot be the fallback. A question mark
 * is the next most legible stand-in: a code point outside the atlas reads as a gap rather
 * than as nothing at all, which is what makes a missing glyph a visible bug.
 */
const FALLBACK = 0x3f

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface RawGlyph {
  unicode: number
  advance: number
  planeBounds?: Bounds
  atlasBounds?: Bounds
}

export class InvalidAtlasError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'InvalidAtlasError'
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidAtlasError(`${path} is not an object`)
  }
  return value as Record<string, unknown>
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidAtlasError(`${path} is not a finite number`)
  }
  return value
}

function bounds(value: unknown, path: string): Bounds {
  const b = record(value, path)
  return {
    left: num(b['left'], `${path}.left`),
    top: num(b['top'], `${path}.top`),
    right: num(b['right'], `${path}.right`),
    bottom: num(b['bottom'], `${path}.bottom`),
  }
}

function rectOf(b: Bounds): { x: number; y: number; width: number; height: number } {
  return { x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top }
}

export function parseAtlasMetrics(json: unknown): FontMetrics {
  const root = record(json, 'atlas file')
  const atlas = record(root['atlas'], 'atlas')

  if (atlas['type'] !== 'msdf') {
    throw new InvalidAtlasError(`atlas.type is "${String(atlas['type'])}", expected "msdf"`)
  }
  if (atlas['yOrigin'] !== 'top') {
    throw new InvalidAtlasError(
      `atlas.yOrigin is "${String(atlas['yOrigin'])}", expected "top". The scene is y-down, ` +
        'so a bottom-up atlas draws every glyph flipped.',
    )
  }

  const width = num(atlas['width'], 'atlas.width')
  const height = num(atlas['height'], 'atlas.height')
  const metrics = record(root['metrics'], 'metrics')

  // Everything downstream is in em. A generator run with a different emSize would scale the
  // whole document without looking wrong anywhere in particular.
  const emSize = num(metrics['emSize'], 'metrics.emSize')
  if (emSize !== 1) {
    throw new InvalidAtlasError(`metrics.emSize is ${emSize}, expected 1`)
  }

  const rawGlyphs = root['glyphs']
  if (!Array.isArray(rawGlyphs)) throw new InvalidAtlasError('glyphs is not an array')

  const glyphs = new Map<number, GlyphMetrics>()
  for (const [index, entry] of rawGlyphs.entries()) {
    const path = `glyphs[${index}]`
    const g = record(entry, path)
    const raw: RawGlyph = {
      unicode: num(g['unicode'], `${path}.unicode`),
      advance: num(g['advance'], `${path}.advance`),
    }

    // Whitespace carries an advance and no bounds. Anything with one bound and not the other
    // is a malformed record rather than whitespace.
    const hasPlane = g['planeBounds'] !== undefined
    const hasAtlas = g['atlasBounds'] !== undefined
    if (hasPlane !== hasAtlas) {
      throw new InvalidAtlasError(`${path} has one of planeBounds and atlasBounds but not both`)
    }

    let quad: GlyphQuad | null = null
    if (hasPlane && hasAtlas) {
      const plane = bounds(g['planeBounds'], `${path}.planeBounds`)
      const inAtlas = bounds(g['atlasBounds'], `${path}.atlasBounds`)
      quad = {
        plane: rectOf(plane),
        uv: {
          x: inAtlas.left / width,
          y: inAtlas.top / height,
          width: (inAtlas.right - inAtlas.left) / width,
          height: (inAtlas.bottom - inAtlas.top) / height,
        },
      }
    }

    glyphs.set(raw.unicode, { advance: raw.advance, quad })
  }

  if (!glyphs.has(FALLBACK)) {
    throw new InvalidAtlasError(
      `The atlas has no U+${FALLBACK.toString(16).toUpperCase()}, which is the fallback glyph`,
    )
  }

  return {
    lineHeight: num(metrics['lineHeight'], 'metrics.lineHeight'),
    ascender: num(metrics['ascender'], 'metrics.ascender'),
    descender: num(metrics['descender'], 'metrics.descender'),
    pxRange: num(atlas['distanceRange'], 'atlas.distanceRange'),
    glyphs,
    fallback: FALLBACK,
  }
}
