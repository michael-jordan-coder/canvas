import { describe, expect, it } from 'vitest'
import {
  angleOf,
  applyToPoint,
  degrees,
  multiply,
  normalizeDegrees,
  radians,
  rotateAbout,
  rotation,
  scaleOf,
  scaling,
  translation,
  withAngle,
} from './math.js'

describe('angleOf', () => {
  it('reads the rotation back out of a rotation matrix', () => {
    expect(degrees(angleOf(rotation(radians(30))))).toBeCloseTo(30, 10)
    expect(degrees(angleOf(rotation(radians(-90))))).toBeCloseTo(-90, 10)
  })

  it('is unaffected by a uniform scale on top of the rotation', () => {
    const m = multiply(scaling(3), rotation(radians(45)))
    expect(degrees(angleOf(m))).toBeCloseTo(45, 10)
  })

  it('is unaffected by translation', () => {
    const m = multiply(rotation(radians(20)), translation(500, -300))
    expect(degrees(angleOf(m))).toBeCloseTo(20, 10)
  })

  it('reports zero for the identity', () => {
    expect(angleOf({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })).toBe(0)
  })
})

describe('scaleOf', () => {
  it('separates a non uniform scale from a rotation', () => {
    const m = multiply(scaling(2, 5), rotation(radians(30)))
    const scale = scaleOf(m)
    expect(scale.x).toBeCloseTo(2, 10)
    expect(scale.y).toBeCloseTo(5, 10)
  })

  it('carries a flip in the sign of y', () => {
    expect(scaleOf(scaling(1, -1)).y).toBeLessThan(0)
  })
})

describe('rotateAbout', () => {
  it('leaves the centre exactly where it was', () => {
    const centre = { x: 40, y: 25 }
    const turned = applyToPoint(rotateAbout(centre, radians(37)), centre)
    expect(turned.x).toBeCloseTo(40, 10)
    expect(turned.y).toBeCloseTo(25, 10)
  })

  it('swings a point a quarter turn around it', () => {
    // Screen y points down, so a positive angle turns clockwise on screen.
    const p = applyToPoint(rotateAbout({ x: 0, y: 0 }, radians(90)), { x: 10, y: 0 })
    expect(p.x).toBeCloseTo(0, 10)
    expect(p.y).toBeCloseTo(10, 10)
  })

  it('is the identity at zero', () => {
    const p = applyToPoint(rotateAbout({ x: 7, y: 9 }, 0), { x: 1, y: 2 })
    expect(p.x).toBeCloseTo(1, 10)
    expect(p.y).toBeCloseTo(2, 10)
  })
})

describe('withAngle', () => {
  it('sets an absolute angle rather than adding to the current one', () => {
    const start = multiply(rotation(radians(30)), translation(10, 20))
    const turned = withAngle(start, radians(80))
    expect(degrees(angleOf(turned))).toBeCloseTo(80, 10)
  })

  it('keeps the scale and the translation', () => {
    const start = multiply(multiply(scaling(2, 3), rotation(radians(15))), translation(10, 20))
    const turned = withAngle(start, radians(70))
    const scale = scaleOf(turned)
    expect(scale.x).toBeCloseTo(2, 10)
    expect(scale.y).toBeCloseTo(3, 10)
    expect(turned.tx).toBe(10)
    expect(turned.ty).toBe(20)
  })
})

describe('normalizeDegrees', () => {
  it('folds a full turn away', () => {
    expect(normalizeDegrees(370)).toBeCloseTo(10, 10)
    expect(normalizeDegrees(-370)).toBeCloseTo(-10, 10)
  })

  it('reads just past a half turn as a small negative rather than a large positive', () => {
    expect(normalizeDegrees(359)).toBeCloseTo(-1, 10)
    expect(normalizeDegrees(270)).toBeCloseTo(-90, 10)
  })

  it('keeps a half turn positive, since the two are the same angle', () => {
    expect(normalizeDegrees(180)).toBe(180)
    expect(normalizeDegrees(-180)).toBe(180)
  })

  it('leaves an angle already in range alone', () => {
    expect(normalizeDegrees(45)).toBe(45)
    expect(normalizeDegrees(0)).toBe(0)
  })
})
