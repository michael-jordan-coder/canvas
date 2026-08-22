export interface Vec2 {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Affine 2x3 transform, same component order as CSS matrix(a, b, c, d, tx, ty):
 *
 *   | a  c  tx |
 *   | b  d  ty |
 *   | 0  0  1  |
 */
export interface Mat2D {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
}

export const IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

export function translation(x: number, y: number): Mat2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y }
}

export function scaling(sx: number, sy: number = sx): Mat2D {
  return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 }
}

export function rotation(radians: number): Mat2D {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 }
}

/** Applies `m` first, then `n`. Reads left to right: parent.then(child). */
export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  return {
    a: n.a * m.a + n.c * m.b,
    b: n.b * m.a + n.d * m.b,
    c: n.a * m.c + n.c * m.d,
    d: n.b * m.c + n.d * m.d,
    tx: n.a * m.tx + n.c * m.ty + n.tx,
    ty: n.b * m.tx + n.d * m.ty + n.ty,
  }
}

export function applyToPoint(m: Mat2D, p: Vec2): Vec2 {
  return {
    x: m.a * p.x + m.c * p.y + m.tx,
    y: m.b * p.x + m.d * p.y + m.ty,
  }
}

/**
 * A direction rather than a position: the same map without the translation.
 *
 * An offset between two points has no origin to be moved from, so translating it would count
 * the translation twice.
 */
export function applyToVector(m: Mat2D, v: Vec2): Vec2 {
  return {
    x: m.a * v.x + m.c * v.y,
    y: m.b * v.x + m.d * v.y,
  }
}

export function invert(m: Mat2D): Mat2D {
  const det = m.a * m.d - m.b * m.c
  if (det === 0) throw new Error('Matrix is not invertible')
  const inv = 1 / det
  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    tx: (m.c * m.ty - m.d * m.tx) * inv,
    ty: (m.b * m.tx - m.a * m.ty) * inv,
  }
}

/** Axis aligned bounds of a rect after transforming its four corners. */
export function transformRect(m: Mat2D, rect: Rect): Rect {
  const corners = [
    applyToPoint(m, { x: rect.x, y: rect.y }),
    applyToPoint(m, { x: rect.x + rect.width, y: rect.y }),
    applyToPoint(m, { x: rect.x, y: rect.y + rect.height }),
    applyToPoint(m, { x: rect.x + rect.width, y: rect.y + rect.height }),
  ]
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

export function rectContains(rect: Rect, p: Vec2): boolean {
  return p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.width && p.y <= rect.y + rect.height
}

/**
 * The rotation baked into a matrix, in radians.
 *
 * Read off the first basis vector, which is where the x axis ended up. That is exact for the
 * rotation and scale this editor produces, and it stays meaningful under a non uniform scale
 * because it only asks about one axis.
 */
export function angleOf(m: Mat2D): number {
  return Math.atan2(m.b, m.a)
}

/** Scale along each axis, with the y sign carrying any flip the matrix encodes. */
export function scaleOf(m: Mat2D): Vec2 {
  const determinant = m.a * m.d - m.b * m.c
  return {
    x: Math.hypot(m.a, m.b),
    y: Math.hypot(m.c, m.d) * (determinant < 0 ? -1 : 1),
  }
}

/** Rotation about an arbitrary point rather than the origin. */
export function rotateAbout(centre: Vec2, radians: number): Mat2D {
  return multiply(
    multiply(translation(-centre.x, -centre.y), rotation(radians)),
    translation(centre.x, centre.y),
  )
}

/**
 * The same matrix turned to an absolute angle, keeping its scale and translation.
 *
 * Skew is discarded, because the result is rebuilt from an angle and two scales and there is
 * nowhere left to put it. Nothing in the editor produces skew, and Figma's rotation field
 * behaves the same way.
 */
export function withAngle(m: Mat2D, radians: number): Mat2D {
  const scale = scaleOf(m)
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    a: scale.x * cos,
    b: scale.x * sin,
    c: -scale.y * sin,
    d: scale.y * cos,
    tx: m.tx,
    ty: m.ty,
  }
}

/**
 * Mirrors across a line through `centre`, parallel to one axis. The same sandwich as
 * `rotateAbout`: shift the centre to the origin, apply the reflection, then shift back.
 *
 * 'horizontal' mirrors left to right, negating x, which is a flip about a vertical line.
 * 'vertical' mirrors top to bottom, negating y. The names match the gesture rather than the
 * axis that gets negated, since that is what a "flip horizontal" command means to a user.
 */
export function reflectAbout(centre: Vec2, axis: 'horizontal' | 'vertical'): Mat2D {
  const mirror = axis === 'horizontal' ? scaling(-1, 1) : scaling(1, -1)
  return multiply(multiply(translation(-centre.x, -centre.y), mirror), translation(centre.x, centre.y))
}

export function degrees(radians: number): number {
  return (radians * 180) / Math.PI
}

export function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Folds an angle into -180 to 180, so a field never reads 359 where it means -1. */
export function normalizeDegrees(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180
  // -180 and 180 are the same angle. Preferring 180 keeps a half turn from flipping sign
  // the moment it is typed in.
  return wrapped === -180 ? 180 : wrapped
}
