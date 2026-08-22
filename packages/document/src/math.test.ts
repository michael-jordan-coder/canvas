import { describe, expect, it } from 'vitest'
import { applyToPoint, reflectAbout, scaleOf } from './math.js'

/**
 * Math.ts's other functions are exercised in rotation.test.ts, alongside the document level
 * rotation tests that lean on them. `reflectAbout` gets its own file because the module that
 * would otherwise host it, apps/editor/src/state/flip.ts, is out of reach from here: this
 * package cannot import the editor.
 */
describe('reflectAbout', () => {
  it('leaves the centre exactly where it was', () => {
    const centre = { x: 12, y: -7 }
    const mirrored = applyToPoint(reflectAbout(centre, 'horizontal'), centre)
    expect(mirrored.x).toBeCloseTo(12, 10)
    expect(mirrored.y).toBeCloseTo(-7, 10)
  })

  it('mirrors horizontally: negates the offset from centre on x, leaves y alone', () => {
    const m = reflectAbout({ x: 0, y: 0 }, 'horizontal')
    const p = applyToPoint(m, { x: 10, y: 5 })
    expect(p.x).toBeCloseTo(-10, 10)
    expect(p.y).toBeCloseTo(5, 10)
  })

  it('mirrors vertically: negates the offset from centre on y, leaves x alone', () => {
    const m = reflectAbout({ x: 0, y: 0 }, 'vertical')
    const p = applyToPoint(m, { x: 10, y: 5 })
    expect(p.x).toBeCloseTo(10, 10)
    expect(p.y).toBeCloseTo(-5, 10)
  })

  it('is its own inverse', () => {
    const m = reflectAbout({ x: 3, y: 8 }, 'horizontal')
    const p = applyToPoint(m, applyToPoint(m, { x: 40, y: -6 }))
    expect(p.x).toBeCloseTo(40, 10)
    expect(p.y).toBeCloseTo(-6, 10)
  })

  it('flips the sign scaleOf reads back, the same signal a rotation with a flip already gives', () => {
    const m = reflectAbout({ x: 0, y: 0 }, 'vertical')
    expect(scaleOf(m).y).toBeLessThan(0)
  })

  it('mirrors about an arbitrary centre, not just the origin', () => {
    const m = reflectAbout({ x: 10, y: 0 }, 'horizontal')
    // A point 4 to the right of the centre lands 4 to its left.
    const p = applyToPoint(m, { x: 14, y: 3 })
    expect(p.x).toBeCloseTo(6, 10)
    expect(p.y).toBeCloseTo(3, 10)
  })
})
