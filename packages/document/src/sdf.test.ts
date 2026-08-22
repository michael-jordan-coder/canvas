import { describe, expect, it } from 'vitest'
import {
  CORNER_ORDER,
  distanceToRoundedBox,
  resolveCornerRadii,
  uniformCornerRadii,
  type CornerRadii,
} from './sdf.js'

const radii = (
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
): CornerRadii => ({ topLeft, topRight, bottomRight, bottomLeft })

const SQUARE = { width: 100, height: 100 }

describe('resolveCornerRadii', () => {
  it('leaves radii that fit exactly as they were typed', () => {
    const input = uniformCornerRadii(10)
    expect(resolveCornerRadii(SQUARE, input)).toEqual(input)
  })

  it('scales two equal radii on one side until they meet', () => {
    expect(resolveCornerRadii(SQUARE, radii(90, 90, 0, 0))).toEqual(radii(50, 50, 0, 0))
  })

  /*
   * The whole reason this is a scale rather than a clamp. Clamping each radius to half the
   * side would leave 50 and 40, which happen to fit, but the 2:1 the user typed would have
   * silently become 5:4. One factor shrinks them together and keeps the proportion.
   */
  it('keeps the proportion between two unequal radii', () => {
    const resolved = resolveCornerRadii(SQUARE, radii(80, 40, 0, 0))
    expect(resolved.topLeft).toBeCloseTo(200 / 3, 6)
    expect(resolved.topRight).toBeCloseTo(100 / 3, 6)
    expect(resolved.topLeft / resolved.topRight).toBeCloseTo(2, 6)
  })

  it('takes the tightest side, not the first one that is over-subscribed', () => {
    // The top edge wants 120 of 100 and the left edge wants 160 of 40, so the height rules.
    const resolved = resolveCornerRadii({ width: 100, height: 40 }, radii(60, 60, 0, 100))
    expect(resolved.topLeft).toBeCloseTo(15, 6)
    expect(resolved.bottomLeft).toBeCloseTo(25, 6)
  })

  it('is idempotent, so resolving an already resolved shape costs nothing', () => {
    const once = resolveCornerRadii(SQUARE, radii(90, 90, 0, 0))
    expect(resolveCornerRadii(SQUARE, once)).toEqual(once)
  })

  it('floors a negative radius rather than letting it pull the others', () => {
    expect(resolveCornerRadii(SQUARE, radii(-5, 10, 0, 0))).toEqual(radii(0, 10, 0, 0))
  })

  it('survives a side with no radius at either end', () => {
    // Both ratios for that side are 0/0 unless the divide is guarded, and one NaN in the
    // minimum makes the whole factor NaN.
    expect(resolveCornerRadii(SQUARE, uniformCornerRadii(0))).toEqual(uniformCornerRadii(0))
  })

  it('reads the corners in the order the GPU does', () => {
    expect(CORNER_ORDER).toEqual(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'])
  })
})

describe('distanceToRoundedBox', () => {
  const half = { x: 50, y: 50 }
  // Radius 40 in one corner puts that arc's centre 10 in from each of its own edges. The
  // corner point itself is 40 * (sqrt(2) - 1) = 16.57 outside the arc, so a point 8 diagonally
  // in from the corner is outside it and one 24 in is inside.
  const OUT = 50 - 8
  const IN = 50 - 24

  const cases: readonly {
    corner: string
    radii: CornerRadii
    sx: number
    sy: number
  }[] = [
    { corner: 'topLeft', radii: radii(40, 0, 0, 0), sx: -1, sy: -1 },
    { corner: 'topRight', radii: radii(0, 40, 0, 0), sx: 1, sy: -1 },
    { corner: 'bottomRight', radii: radii(0, 0, 40, 0), sx: 1, sy: 1 },
    { corner: 'bottomLeft', radii: radii(0, 0, 0, 40), sx: -1, sy: 1 },
  ]

  /*
   * Per quadrant, with the other three corners square. A radius applied to the wrong corner
   * fails both halves at once: the bite is missing where it belongs and present where it
   * does not.
   */
  for (const { corner, radii: r, sx, sy } of cases) {
    it(`bites ${corner} out of its own quadrant and no other`, () => {
      expect(distanceToRoundedBox({ x: sx * OUT, y: sy * OUT }, half, r)).toBeGreaterThan(0)
      expect(distanceToRoundedBox({ x: sx * IN, y: sy * IN }, half, r)).toBeLessThan(0)
      // The opposite corner keeps its square, so the same point there is still inside.
      expect(distanceToRoundedBox({ x: -sx * OUT, y: -sy * OUT }, half, r)).toBeLessThan(0)
    })
  }

  it('is negative inside and zero on the edge', () => {
    expect(distanceToRoundedBox({ x: 0, y: 0 }, half, uniformCornerRadii(0))).toBe(-50)
    expect(distanceToRoundedBox({ x: 50, y: 0 }, half, uniformCornerRadii(0))).toBe(0)
  })

  it('reports the true distance outside a square corner', () => {
    const d = distanceToRoundedBox({ x: 53, y: 54 }, half, uniformCornerRadii(0))
    expect(d).toBeCloseTo(5, 6)
  })

  /*
   * The guard the shader carries too. Resolution stops adjacent radii overlapping but not a
   * lone radius past the shortest half extent, which would put the arc's centre outside the
   * box and turn the corner inside out.
   */
  it('caps a radius at the shortest half extent, so a corner cannot invert', () => {
    const capped = distanceToRoundedBox({ x: 0, y: 0 }, half, uniformCornerRadii(400))
    expect(capped).toBe(distanceToRoundedBox({ x: 0, y: 0 }, half, uniformCornerRadii(50)))
  })
})
