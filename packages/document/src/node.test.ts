import { describe, expect, it } from 'vitest'
import { cloneNode, createRectangle, type RectangleNode } from './node.js'
import {
  fromHex,
  type DropShadow,
  type GradientPaint,
  type Paint,
  type SolidPaint,
  type Stroke,
} from './paint.js'

/** Narrows a paint the test built as a solid, failing loudly if the clone changed its kind. */
function asSolid(paint: Paint | undefined): SolidPaint {
  if (paint?.type !== 'solid') throw new Error('expected a solid paint')
  return paint
}

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
    expect(asSolid(fills[1]).color.g).toBe(1)
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
    asSolid(stroke.paint).color.g = 1

    expect(clone.fills).toHaveLength(1)
    expect(asSolid(clone.fills[0]).color.r).toBeCloseTo(10 / 255, 6)
    expect(asSolid(clone.strokes[0]?.paint).color.g).toBe(0)
  })
})

/*
 * The gradient case of `clonePaint`: the stops array and each stop's colour need their own
 * copies, or history and autosave share state with the live document and a later edit
 * quietly rewrites the past. This is exactly the bug the switch stopping compiling on the
 * union growing was meant to force a decision about.
 */
describe('cloneNode and gradients', () => {
  const cloneOf = (node: RectangleNode): RectangleNode => cloneNode(node) as RectangleNode

  const gradient = (): GradientPaint => ({
    type: 'linear',
    from: { x: 0.5, y: 0 },
    to: { x: 0.5, y: 1 },
    stops: [
      { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 0 } },
    ],
  })

  it('round trips every field of a gradient', () => {
    const node = createRectangle({ fills: [{ ...gradient(), opacity: 0.5 }] })
    expect(cloneOf(node).fills[0]).toEqual(node.fills[0])
  })

  it('shares no stop with the original, so a later edit cannot rewrite the past', () => {
    const fill = gradient()
    const node = createRectangle({ fills: [fill] })
    const clone = cloneOf(node)

    fill.stops[0]!.color.r = 0
    fill.stops[0]!.position = 0.5
    fill.stops.push({ position: 1, color: { r: 0, g: 0, b: 0, a: 1 } })
    fill.from.x = 0

    const kept = clone.fills[0]
    if (kept?.type !== 'linear') throw new Error('expected a linear gradient')
    expect(kept.stops).toHaveLength(2)
    expect(kept.stops[0]).toEqual({ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } })
    expect(kept.from.x).toBe(0.5)
  })
})

describe('cloneNode and effects', () => {
  const cloneOf = (node: RectangleNode): RectangleNode => cloneNode(node) as RectangleNode

  it('deep copies a shadow, and keeps absence absent', () => {
    const shadow: DropShadow = {
      offset: { x: 2, y: 4 },
      blur: 8,
      spread: 1,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
    }
    const node = createRectangle({ effects: [shadow] })
    const clone = cloneOf(node)

    shadow.offset.x = 99
    shadow.color.a = 1
    expect(clone.effects?.[0]).toEqual({
      offset: { x: 2, y: 4 },
      blur: 8,
      spread: 1,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
    })

    expect(cloneOf(createRectangle())).not.toHaveProperty('effects')
  })
})
