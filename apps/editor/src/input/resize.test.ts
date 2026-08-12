import { describe, expect, it } from 'vitest'
import { IDENTITY, translation, type Rect } from '@figma-canvas/document'
import { anchorFor, axesFor, handlePointFor, resizedNode, scaleFactors } from './resize'

/** 100 wide, 50 tall, top left at the origin. */
const box: Rect = { x: 0, y: 0, width: 100, height: 50 }

describe('axesFor', () => {
  it('scales both axes from a corner and one from an edge', () => {
    expect(axesFor('se')).toEqual({ x: true, y: true })
    expect(axesFor('nw')).toEqual({ x: true, y: true })
    expect(axesFor('e')).toEqual({ x: true, y: false })
    expect(axesFor('n')).toEqual({ x: false, y: true })
  })
})

describe('anchorFor', () => {
  it('anchors a corner to the opposite corner', () => {
    expect(anchorFor('se', box, false)).toEqual({ x: 0, y: 0 })
    expect(anchorFor('nw', box, false)).toEqual({ x: 100, y: 50 })
    expect(anchorFor('ne', box, false)).toEqual({ x: 0, y: 50 })
  })

  it('anchors an edge to the opposite edge, staying centred on the other axis', () => {
    expect(anchorFor('e', box, false)).toEqual({ x: 0, y: 25 })
    expect(anchorFor('n', box, false)).toEqual({ x: 50, y: 50 })
  })

  it('anchors to the centre when alt is held', () => {
    expect(anchorFor('se', box, true)).toEqual({ x: 50, y: 25 })
    expect(anchorFor('n', box, true)).toEqual({ x: 50, y: 25 })
  })
})

describe('scaleFactors', () => {
  const factors = (handle: Parameters<typeof scaleFactors>[1], pointer: { x: number; y: number }, options = { constrain: false }) =>
    scaleFactors(box, handle, anchorFor(handle, box, false), pointer, options)

  it('doubles when the handle is dragged to twice the distance', () => {
    expect(factors('se', { x: 200, y: 100 })).toEqual({ sx: 2, sy: 2 })
  })

  it('leaves the other axis alone for an edge handle', () => {
    const { sx, sy } = factors('e', { x: 150, y: 999 })
    expect(sx).toBe(1.5)
    expect(sy).toBe(1)
  })

  it('grows towards the anchor for a north west handle', () => {
    // Anchor is the south east corner at (100,50). Dragging nw to (-100,-50) doubles it.
    expect(factors('nw', { x: -100, y: -50 })).toEqual({ sx: 2, sy: 2 })
  })

  it('takes the larger factor on both axes when constrained', () => {
    const { sx, sy } = factors('se', { x: 300, y: 60 }, { constrain: true })
    expect(sx).toBe(3)
    expect(sy).toBe(3)
  })

  it('does not constrain an edge handle, which only has one axis', () => {
    const { sx, sy } = factors('e', { x: 300, y: 999 }, { constrain: true })
    expect(sx).toBe(3)
    expect(sy).toBe(1)
  })

  it('refuses to collapse or invert the box', () => {
    // Dragging the south east handle far past the anchor at the origin.
    const { sx, sy } = factors('se', { x: -500, y: -500 })
    expect(sx).toBeGreaterThan(0)
    expect(sy).toBeGreaterThan(0)
    expect(box.width * sx).toBeCloseTo(1, 6)
    expect(box.height * sy).toBeCloseTo(1, 6)
  })

  it('scales about the centre when the anchor is the centre', () => {
    const anchor = anchorFor('se', box, true)
    // The handle starts at (100,50), 50 and 25 from the centre. Twice that is (150,75).
    const { sx, sy } = scaleFactors(box, 'se', anchor, { x: 150, y: 75 }, { constrain: false })
    expect(sx).toBe(2)
    expect(sy).toBe(2)
  })

  it('grows from the centre with the aspect held when alt and shift are both down', () => {
    const anchor = anchorFor('se', box, true)
    expect(anchor).toEqual({ x: 50, y: 25 })

    // Dragging the south east corner well out on x and barely on y.
    const { sx, sy } = scaleFactors(box, 'se', anchor, { x: 150, y: 30 }, { constrain: true })
    expect(sx).toBe(2)
    expect(sy).toBe(2)
  })

  it('moves all four corners when alt and shift are combined', () => {
    const anchor = anchorFor('se', box, true)
    const { sx, sy } = scaleFactors(box, 'se', anchor, { x: 150, y: 30 }, { constrain: true })

    // The box as a whole, rebuilt from the anchor and the factors.
    const width = box.width * sx
    const height = box.height * sy
    const resized = {
      x: anchor.x - (anchor.x - box.x) * sx,
      y: anchor.y - (anchor.y - box.y) * sy,
      width,
      height,
    }

    // Every edge moved outward, which is what "all corners" means.
    expect(resized.x).toBeLessThan(box.x)
    expect(resized.y).toBeLessThan(box.y)
    expect(resized.x + resized.width).toBeGreaterThan(box.x + box.width)
    expect(resized.y + resized.height).toBeGreaterThan(box.y + box.height)

    // Symmetric about the centre, and the aspect ratio is unchanged.
    expect(resized.x + resized.width / 2).toBeCloseTo(anchor.x, 9)
    expect(resized.y + resized.height / 2).toBeCloseTo(anchor.y, 9)
    expect(width / height).toBeCloseTo(box.width / box.height, 9)
  })

  it('holds the aspect from any corner, not just the south east one', () => {
    for (const handle of ['nw', 'ne', 'sw', 'se'] as const) {
      const anchor = anchorFor(handle, box, true)
      const { sx, sy } = scaleFactors(box, handle, anchor, { x: 200, y: 26 }, { constrain: true })
      expect(sx).toBe(sy)
    }
  })

  it('survives a zero width box rather than dividing by it', () => {
    const flat: Rect = { x: 10, y: 0, width: 0, height: 50 }
    const { sx } = scaleFactors(flat, 'e', anchorFor('e', flat, false), { x: 99, y: 0 }, {
      constrain: false,
    })
    expect(Number.isFinite(sx)).toBe(true)
  })
})

describe('handlePointFor', () => {
  it('reports where the grabbed handle started', () => {
    expect(handlePointFor('se', box)).toEqual({ x: 100, y: 50 })
    expect(handlePointFor('n', box)).toEqual({ x: 50, y: 0 })
  })
})

describe('resizedNode', () => {
  const target = {
    parentInverse: IDENTITY,
    startTransform: translation(20, 10),
    startSize: { width: 100, height: 50 },
  }

  it('scales size and position about the anchor', () => {
    const { transform, size } = resizedNode(target, { x: 0, y: 0 }, 2, 2)
    expect(transform.tx).toBe(40)
    expect(transform.ty).toBe(20)
    expect(size).toEqual({ width: 200, height: 100 })
  })

  it('leaves a node sitting on the anchor exactly where it is', () => {
    const onAnchor = { ...target, startTransform: translation(0, 0) }
    const { transform } = resizedNode(onAnchor, { x: 0, y: 0 }, 3, 3)
    expect(transform.tx).toBe(0)
    expect(transform.ty).toBe(0)
  })

  it('changes size rather than baking a scale into the transform', () => {
    // This is what keeps a corner radius from stretching when a shape is resized.
    const { transform } = resizedNode(target, { x: 0, y: 0 }, 2, 2)
    expect(transform.a).toBe(1)
    expect(transform.d).toBe(1)
  })

  it('scales each axis independently for an edge drag', () => {
    const { size } = resizedNode(target, { x: 0, y: 0 }, 1.5, 1)
    expect(size).toEqual({ width: 150, height: 50 })
  })
})
