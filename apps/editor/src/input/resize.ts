import type { Mat2D, Rect, Size, Vec2 } from '@figma-canvas/document'
import type { HandleId } from '@figma-canvas/renderer'

export interface ResizeAxes {
  x: boolean
  y: boolean
}

/** A corner scales both axes, an edge only its own. */
export function axesFor(handle: HandleId): ResizeAxes {
  return {
    x: handle.includes('e') || handle.includes('w'),
    y: handle.includes('n') || handle.includes('s'),
  }
}

/**
 * The point that stays still while the handle moves: normally the opposite corner or edge,
 * or the centre of the box when alt is held.
 */
export function anchorFor(handle: HandleId, bounds: Rect, fromCentre: boolean): Vec2 {
  const centreX = bounds.x + bounds.width / 2
  const centreY = bounds.y + bounds.height / 2
  if (fromCentre) return { x: centreX, y: centreY }

  return {
    x: handle.includes('w') ? bounds.x + bounds.width : handle.includes('e') ? bounds.x : centreX,
    y: handle.includes('n') ? bounds.y + bounds.height : handle.includes('s') ? bounds.y : centreY,
  }
}

/** Where the grabbed handle sat when the gesture began. */
export function handlePointFor(handle: HandleId, bounds: Rect): Vec2 {
  return {
    x: handle.includes('w')
      ? bounds.x
      : handle.includes('e')
        ? bounds.x + bounds.width
        : bounds.x + bounds.width / 2,
    y: handle.includes('n')
      ? bounds.y
      : handle.includes('s')
        ? bounds.y + bounds.height
        : bounds.y + bounds.height / 2,
  }
}

export interface ScaleOptions {
  /** Shift: keep the aspect ratio by taking the larger of the two factors. */
  constrain: boolean
  /** Smallest the box may become, in world units. Stops it collapsing or turning inside out. */
  minimum?: number
}

const EPSILON = 1e-6

function ratio(moved: number, original: number): number {
  // A zero length side has no meaningful scale, and dividing by it would produce infinity.
  return Math.abs(original) < EPSILON ? 1 : moved / original
}

/**
 * How much the box grows on each axis as the pointer drags a handle.
 *
 * Factors are dimensionless, which is what makes them usable unchanged in any node's parent
 * space no matter how that parent is scaled.
 */
export function scaleFactors(
  bounds: Rect,
  handle: HandleId,
  anchor: Vec2,
  pointer: Vec2,
  options: ScaleOptions,
): { sx: number; sy: number } {
  const axes = axesFor(handle)
  const start = handlePointFor(handle, bounds)

  let sx = axes.x ? ratio(pointer.x - anchor.x, start.x - anchor.x) : 1
  let sy = axes.y ? ratio(pointer.y - anchor.y, start.y - anchor.y) : 1

  if (options.constrain && axes.x && axes.y) {
    const larger = Math.max(Math.abs(sx), Math.abs(sy))
    sx = larger
    sy = larger
  }

  // Clamped positive rather than allowed to go negative. Dragging a handle past its anchor
  // flips the shape in Figma, which needs a negative scale in the transform and a rethink of
  // what the SDF does with it. Until then the box stops instead of inverting.
  const minimum = options.minimum ?? 1
  if (axes.x) sx = Math.max(sx, bounds.width > EPSILON ? minimum / bounds.width : 1)
  if (axes.y) sy = Math.max(sy, bounds.height > EPSILON ? minimum / bounds.height : 1)

  return { sx, sy }
}

export interface ResizeTarget {
  parentInverse: Mat2D
  startTransform: Mat2D
  startSize: Size
}

/**
 * Where one node ends up.
 *
 * The node's size changes rather than its transform picking up a scale, so a corner radius
 * and, later, a stroke weight stay in node units and do not stretch with the shape. That is
 * what Figma does, and it is why resizing a rounded rectangle keeps its corners.
 *
 * `anchor` is the fixed point expressed in this node's parent space.
 */
export function resizedNode(
  target: ResizeTarget,
  anchor: Vec2,
  sx: number,
  sy: number,
): { transform: Mat2D; size: Size } {
  return {
    transform: {
      ...target.startTransform,
      tx: anchor.x + (target.startTransform.tx - anchor.x) * sx,
      ty: anchor.y + (target.startTransform.ty - anchor.y) * sy,
    },
    size: {
      width: target.startSize.width * sx,
      height: target.startSize.height * sy,
    },
  }
}
