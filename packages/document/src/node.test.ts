import { describe, expect, it } from 'vitest'
import { cloneNode, createRectangle, type RectangleNode } from './node.js'
import { fromHex, type Stroke } from './paint.js'

/**
 * `cloneNode` is the history snapshot and, through `serializeDocument`, the save, so a field
 * it forgets is a field an undo or an autosave silently rewrites. These pin the paint half
 * of that, which used to be a hardcoded solid rebuilt from its colour alone.
 */
describe('cloneNode and paints', () => {
  const cloneOf = (node: RectangleNode): RectangleNode => cloneNode(node) as RectangleNode

  it('carries every field of a paint, not just its colour', () => {
    const node = createRectangle({
      fills: [{ ...fromHex('#0a7cff'), opacity: 0.4, visible: false }],
    })
    expect(cloneOf(node).fills[0]).toEqual(node.fills[0])
  })

  it('round trips two fills of different opacity, in order', () => {
    const node = createRectangle({
      fills: [
        { ...fromHex('#ff0000'), opacity: 0.25 },
        { ...fromHex('#00ff00'), opacity: 0.75 },
      ],
    })
    const fills = cloneOf(node).fills
    expect(fills.map((fill) => fill.opacity)).toEqual([0.25, 0.75])
    expect(fills[1]?.color.g).toBe(1)
  })

  // Absence is the default, so a clone that invented the key would no longer be
  // indistinguishable from the original.
  it('leaves an absent field absent rather than filling in its default', () => {
    const node = createRectangle({ fills: [fromHex('#0a7cff')] })
    expect(cloneOf(node).fills[0]).not.toHaveProperty('opacity')
    expect(cloneOf(node).fills[0]).not.toHaveProperty('visible')
  })

  it('shares nothing with the original, so a later edit cannot rewrite the past', () => {
    const fill = fromHex('#0a7cff')
    const stroke: Stroke = { paint: fromHex('#ff0000'), weight: 2, align: 'inside' }
    const node = createRectangle({ fills: [fill], strokes: [stroke] })
    const clone = cloneOf(node)

    fill.color.r = 1
    node.fills.push(fromHex('#000000'))
    stroke.paint.color.g = 1

    expect(clone.fills).toHaveLength(1)
    expect(clone.fills[0]?.color.r).toBeCloseTo(10 / 255, 6)
    expect(clone.strokes[0]?.paint.color.g).toBe(0)
  })
})
