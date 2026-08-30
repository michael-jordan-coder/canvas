import type { Vec2 } from './math.js'

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

export interface GradientStop {
  /** 0 to 1 along the gradient's axis. */
  position: number
  color: RGBA
}

/**
 * The most stops one gradient may carry. The shader walks the stops and a walk needs a
 * bound for the same reason `MAX_CLIP_DEPTH` has one: a malformed record must not hang the
 * GPU. Eight is generous for real documents, and the parser refuses more rather than
 * silently dropping the ninth.
 */
export const MAX_GRADIENT_STOPS = 8

export interface GradientPaint extends PaintBase {
  type: 'linear' | 'radial'
  /**
   * The axis, in the node's own 0..1 box space. Linear runs from `from` to `to`. Radial
   * centres on `from` with `to` naming the edge of the ellipse, so both kinds need the
   * same two points and one geometry path serves them.
   *
   * Box space rather than world units, so a gradient survives a resize without
   * recomputation. Because the box is normalised, a circle here is an ellipse in node
   * units, stretched with the node's own aspect.
   *
   * `stops` is sorted by position, and that is an invariant: the shader walks them in
   * order, and an unsorted array reads as a scrambled ramp, which looks like a shader bug
   * and is not one. Everything that writes stops sorts them on the way in.
   */
  from: Vec2
  to: Vec2
  stops: GradientStop[]
}

export type Paint = SolidPaint | GradientPaint

/** A paint's own opacity, which multiplies with its colour's alpha and with the node's. */
export function paintOpacity(paint: Paint): number {
  return paint.opacity ?? 1
}

/**
 * The one colour that stands for the paint: a solid's own, a gradient's first stop.
 *
 * This is what the instance's colour slot carries even when the paint is a gradient, so
 * everything that wants one swatch per paint (the selection colours tally, the agent's hex
 * report, the shader if the gradient bit is ever unset) asks here instead of narrowing the
 * union three separate ways. A gradient with no stops cannot be constructed through the
 * parser or the panel, so the fallback black is unreachable rather than a default.
 */
export function paintColor(paint: Paint): RGBA {
  if (paint.type === 'solid') return paint.color
  return paint.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 }
}

/** In place, because every caller has just built or cloned the array it hands over. */
export function sortStops(stops: GradientStop[]): GradientStop[] {
  return stops.sort((a, b) => a.position - b.position)
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

/**
 * A drop shadow. Offset is in the node's own units and travels with its transform, so a
 * shadow turns and scales with the node the way its stroke does.
 *
 * Deliberately not part of hit testing or the selection bounds: a shadow is not clickable,
 * in Figma either, and it does not enlarge the box that zoom-to-fit and multi-select frame.
 * `strokesOutset` stays the only thing that grows a node's clickable area; do not add an
 * `effectsOutset`, the omission is the design.
 */
export interface DropShadow {
  offset: Vec2
  /** Never negative. Zero is a sharp-edged shadow, not an invalid one. */
  blur: number
  spread: number
  color: RGBA
  /** Absent means shown, matching a paint's `visible`. */
  visible?: boolean
}

export function isEffectVisible(effect: DropShadow): boolean {
  return effect.visible !== false
}

/**
 * The shadows a node actually draws, back to front, hidden ones dropped. Reversed for the
 * same reason `drawnPaints` is: the panel lists the topmost effect first, the buffer paints
 * what it is handed first at the bottom.
 */
export function drawnEffects(effects: readonly DropShadow[] | undefined): DropShadow[] {
  if (!effects) return []
  const drawn: DropShadow[] = []
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index]
    if (effect && isEffectVisible(effect)) drawn.push(effect)
  }
  return drawn
}

/**
 * How far a shadow's edge reaches past the node's own, never negative. The offset is not
 * part of it on purpose: it rides in the shadow instance's transform, so the quad padding
 * this feeds stays uniform on all four sides.
 */
export function shadowReach(effect: DropShadow): number {
  return Math.max(0, effect.spread + effect.blur)
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

/**
 * Hue in degrees, saturation and value 0..1, the picker's own space rather than the
 * document's: a saturation/value square and a hue ring both move one channel at a time,
 * which RGB has no axis for.
 */
export interface HSV {
  h: number
  s: number
  v: number
}

/** Grey (`max === 0` or `delta === 0`) keeps whatever hue it is handed, so dragging value
 *  down to black and back up returns a picker to the hue it started from rather than red. */
export function rgbToHsv({ r, g, b }: RGBA, hueForGrey = 0): HSV {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = hueForGrey
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6)
    else if (max === g) h = 60 * ((b - r) / delta + 2)
    else h = 60 * ((r - g) / delta + 4)
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToRgb({ h, s, v }: HSV, a = 1): RGBA {
  const c = v * s
  const hh = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const [r1, g1, b1] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x]
  const m = v - c
  return { r: r1 + m, g: g1 + m, b: b1 + m, a }
}
