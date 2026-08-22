import { describe, expect, it } from 'vitest'
import { BYTES_PER_INSTANCE, FLOATS_PER_INSTANCE, SHAPE_ATTRIBUTES } from './instanceLayout.js'

/** Every vertex format this layout uses, as how many bytes it occupies. */
const SIZES: Record<string, number> = {
  float32: 4,
  float32x2: 8,
  float32x3: 12,
  float32x4: 16,
}

describe('the shape instance layout', () => {
  it('measures the same stride in floats and in bytes', () => {
    expect(FLOATS_PER_INSTANCE * 4).toBe(BYTES_PER_INSTANCE)
  })

  it('names one attribute per location, 0 through 5', () => {
    expect(SHAPE_ATTRIBUTES.map((attribute) => attribute.shaderLocation)).toEqual([0, 1, 2, 3, 4, 5])
  })

  /*
   * The property that actually matters: an attribute reading past its neighbour would draw
   * the wrong shape, and a gap would waste bytes the packer never writes. Checked by walking
   * the offsets rather than by restating them, so it holds whatever the layout grows into.
   */
  it('tiles the whole stride with no gap and no overlap', () => {
    let next = 0
    for (const attribute of SHAPE_ATTRIBUTES) {
      const size = SIZES[attribute.format]
      expect(size, `unknown format ${attribute.format}`).toBeDefined()
      expect(attribute.offset).toBe(next)
      next += size ?? 0
    }
    expect(next).toBe(BYTES_PER_INSTANCE)
  })

  it('starts every attribute on a 16 byte boundary, so none of them needs padding', () => {
    for (const attribute of SHAPE_ATTRIBUTES) expect(attribute.offset % 16).toBe(0)
  })
})
