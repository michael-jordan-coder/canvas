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

/**
 * What every paint carries whatever it draws.
 *
 * Both fields are optional and absence is the default, which is what makes them cost no
 * schema version: a file written before they existed and a paint that simply has neither
 * read identically, so `parsePaint` needs no version gate. It is the same shape `layout`
 * and `layoutChild` already use.
 *
 * `opacity` multiplies with the colour's own alpha and with the node's rather than
 * replacing either. Three separate things can make a paint faint and they compose.
 */
export interface PaintBase {
  /** 0 to 1. Absent means 1. */
  opacity?: number
  /** Absent means shown. False keeps the paint in the stack without drawing it. */
  visible?: boolean
}

export interface SolidPaint extends PaintBase {
  type: 'solid'
  color: RGBA
}

export type Paint = SolidPaint

/** A paint's own opacity, which multiplies with its colour's alpha and with the node's. */
export function paintOpacity(paint: Paint): number {
  return paint.opacity ?? 1
}

/** Whether the paint draws at all. A hidden paint keeps its place in the stack. */
export function isPaintVisible(paint: Paint): boolean {
  return paint.visible !== false
}

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

/**
 * The paints a node actually draws, back to front, hidden ones dropped.
 *
 * Reversed, because the two ends disagree on purpose. The panel lists paints the way Figma
 * does, with the first row nearest the top of the stack, while the instance buffer paints
 * in the order it is packed. So `paints[0]` is emitted last and lands on top of the rest,
 * and painter's order composites the stack for free.
 */
export function drawnPaints(paints: readonly Paint[]): Paint[] {
  const drawn: Paint[] = []
  for (let index = paints.length - 1; index >= 0; index -= 1) {
    const paint = paints[index]
    if (paint && isPaintVisible(paint)) drawn.push(paint)
  }
  return drawn
}

/**
 * The strokes a node actually draws, back to front, in the same order and for the same
 * reason as the fills above. A weightless stroke has no band to draw, so it is dropped here
 * rather than packed as an empty one.
 */
export function drawnStrokes(strokes: readonly Stroke[]): Stroke[] {
  const drawn: Stroke[] = []
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index]
    if (stroke && stroke.weight > 0 && isPaintVisible(stroke.paint)) drawn.push(stroke)
  }
  return drawn
}

/**
 * How far the furthest reaching drawn stroke goes past the node's own edge.
 *
 * The largest of them rather than the first: every stroke in the list is on screen at once,
 * so the clickable area has to cover the outermost one or a click on a stroke you can
 * plainly see would miss. That is the rule the single stroke case always followed, asked of
 * a stack instead of one.
 */
export function strokesOutset(strokes: readonly Stroke[]): number {
  let outset = 0
  for (const stroke of drawnStrokes(strokes)) outset = Math.max(outset, strokeOutset(stroke))
  return outset
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
