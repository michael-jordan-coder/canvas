import type { Size, Vec2 } from './math.js'

/**
 * The four corners of a rounded box, each with its own radius.
 *
 * A shape carries these unresolved, exactly as they were typed. What is drawn is
 * `resolveCornerRadii` of them, and every consumer calls it rather than storing the answer,
 * because the answer depends on the size and the size changes on every resize.
 */
export interface CornerRadii {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

/**
 * The order the GPU reads them in. The packer and the clip table both write this order, and
 * the shader's `select` pairs depend on it: xy is the top pair, wz the bottom one.
 */
export const CORNER_ORDER = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const

/** All four the same, which is what a scalar radius meant and what every shape starts with. */
export function uniformCornerRadii(radius = 0): CornerRadii {
  return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }
}

/**
 * The radii actually drawn, scaled down together until no side is over-subscribed.
 *
 * A per-corner clamp is not enough. On a 100x100 box with `topLeft` and `topRight` both 90,
 * each clamps independently to 50, the two arcs meet and overlap across the top edge, and the
 * distance field folds: a visible cusp, and one where drawing and hit testing disagree
 * because each folds slightly differently. CSS solves it by scaling every radius by a single
 * factor rather than clamping each, which keeps the proportions the user typed.
 *
 * It runs once per instance on the CPU rather than per pixel on the GPU: it needs all four
 * radii and both sides at once and gives the same answer for every pixel of the shape. It is
 * also the only reason the packer, the clip table and `hit.ts` agree, rather than being three
 * careful reimplementations of the same clamp.
 */
export function resolveCornerRadii(size: Size, radii: CornerRadii): CornerRadii {
  const r = {
    topLeft: Math.max(0, radii.topLeft),
    topRight: Math.max(0, radii.topRight),
    bottomRight: Math.max(0, radii.bottomRight),
    bottomLeft: Math.max(0, radii.bottomLeft),
  }

  // A side with no radius on either end constrains nothing, and dividing by its zero sum
  // would poison the minimum with a NaN.
  const ratio = (available: number, sum: number): number =>
    sum > 0 ? available / sum : Number.POSITIVE_INFINITY

  const f = Math.min(
    1,
    ratio(size.width, r.topLeft + r.topRight),
    ratio(size.width, r.bottomLeft + r.bottomRight),
    ratio(size.height, r.topLeft + r.bottomLeft),
    ratio(size.height, r.topRight + r.bottomRight),
  )

  // The common case by far, and returning the input unscaled keeps it exactly the number
  // that was typed rather than that number times 1.
  if (f >= 1) return r

  return {
    topLeft: r.topLeft * f,
    topRight: r.topRight * f,
    bottomRight: r.bottomRight * f,
    bottomLeft: r.bottomLeft * f,
  }
}

/**
 * Distance from a point to a rounded box, negative inside. The same function the fragment
 * shader uses, so what you can click is exactly what you can see, including the bite each
 * corner radius takes out of its own corner.
 *
 * `p` is relative to the centre of the box. The corner is chosen by the sign of `p` before
 * the `abs` below, because that fold maps all four quadrants onto one and takes the only
 * evidence of which corner this point is nearest with it.
 */
export function distanceToRoundedBox(p: Vec2, half: Vec2, radii: CornerRadii): number {
  const top = p.y < 0
  const left = p.x < 0
  const corner = top
    ? left
      ? radii.topLeft
      : radii.topRight
    : left
      ? radii.bottomLeft
      : radii.bottomRight

  // Last-ditch guard, matching the shader's. A radius past the shortest half extent puts the
  // arc's centre outside the box and turns the corner inside out. Resolving usually prevents
  // it, but a single large radius on one corner survives resolution and still has to be safe.
  const r = Math.min(corner, Math.min(half.x, half.y))

  const qx = Math.abs(p.x) - half.x + r
  const qy = Math.abs(p.y) - half.y + r
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - r
}
