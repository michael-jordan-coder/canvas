/**
 * Channels are 0..1 rather than 0..255 because that is what the GPU wants. Converting
 * per frame for every node is waste, so the document stores the GPU-native form and the
 * panels convert on the way in and out.
 */
export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface SolidPaint {
  type: 'solid'
  color: RGBA
}

export type Paint = SolidPaint

export type StrokeAlign = 'inside' | 'outside' | 'center'

export interface Stroke {
  paint: Paint
  weight: number
  align: StrokeAlign
}

/**
 * Where the middle of the stroke sits, as a signed distance from the shape's edge.
 *
 * The renderer and hit testing both work from the same signed distance `d`, negative inside
 * the shape. A stroke is the band `abs(d - offset) <= weight / 2`, so alignment is one number
 * rather than three code paths.
 */
export function strokeOffset(stroke: Stroke): number {
  switch (stroke.align) {
    case 'inside':
      return -stroke.weight / 2
    case 'outside':
      return stroke.weight / 2
    case 'center':
      return 0
  }
}

/**
 * How far the stroke reaches past the shape's own edge, never negative.
 *
 * This is what the quad has to be padded by before drawing, and what the clickable area has
 * to grow by. An inside stroke returns 0, which is why it is the only alignment that leaves
 * a node's footprint alone.
 */
export function strokeOutset(stroke: Stroke): number {
  return Math.max(0, strokeOffset(stroke) + stroke.weight / 2)
}

/** The stroke a node actually paints, if any. One stroke for now, like one fill. */
export function activeStroke(strokes: readonly Stroke[]): Stroke | undefined {
  const stroke = strokes[0]
  return stroke && stroke.weight > 0 ? stroke : undefined
}

export function solid(r: number, g: number, b: number, a = 1): SolidPaint {
  return { type: 'solid', color: { r, g, b, a } }
}

export function fromHex(hex: string, a = 1): SolidPaint {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  const int = Number.parseInt(full, 16)
  return solid(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255, a)
}

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Parses a typed or pasted hex string, or null if it is not a valid 3 or 6 digit hex colour. */
export function parseHex(value: string, a = 1): SolidPaint | null {
  const trimmed = value.trim()
  return HEX_COLOR.test(trimmed) ? fromHex(trimmed, a) : null
}

export function toHex(color: RGBA): string {
  const channel = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}
