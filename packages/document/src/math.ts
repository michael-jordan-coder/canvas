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
