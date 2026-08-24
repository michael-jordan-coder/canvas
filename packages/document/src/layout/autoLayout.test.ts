import { describe, expect, it } from 'vitest'
import { SceneDocument } from '../document.js'
import { reflectAbout, rotation, translation } from '../math.js'
import {
  createFrame,
  createRectangle,
  createText,
  defaultFrameLayout,
  type FrameLayout,
  type FrameNode,
  type NodeId,
  type SceneNode,
} from '../node.js'
import {
  applyLayout,
  computeLayout,
  inferLayout,
  insertionIndex,
  layoutRootsFor,
  type LayoutPatch,
  type TextMeasurer,
} from './autoLayout.js'

/** A measurer that wraps to the given width at 20 units a line, 100 units of text per line. */
const measurer: TextMeasurer = {
  measure: (node, wrapWidth) => ({
    width: wrapWidth,
    height: 20 * Math.max(1, Math.ceil((node.characters.length * 10) / wrapWidth)),
  }),
}

const unmeasured: TextMeasurer = { measure: () => null }

function layout(overrides: Partial<FrameLayout> = {}): FrameLayout {
  return {
    ...defaultFrameLayout('horizontal'),
    gap: 10,
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
    ...overrides,
  }
}

function patchFor(patches: LayoutPatch[], id: NodeId): LayoutPatch | undefined {
  return patches.find((patch) => patch.id === id)
}

/** Applies and re-runs, asserting the second pass finds nothing left to do. */
function settle(document: SceneDocument, frameId: NodeId, m: TextMeasurer = measurer): void {
  applyLayout(document, computeLayout(document, frameId, m))
  expect(computeLayout(document, frameId, m)).toEqual([])
}

function placed(document: SceneDocument, node: SceneNode): { x: number; y: number } {
  const live = document.expectNode(node.id)
  return { x: live.transform.tx, y: live.transform.ty }
}

describe('computeLayout', () => {
  it('packs a row with gap and padding', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    const a = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const b = document.insert(createRectangle({ size: { width: 60, height: 40 } }), frame.id)

    settle(document, frame.id)
    expect(placed(document, a)).toEqual({ x: 10, y: 10 })
    expect(placed(document, b)).toEqual({ x: 70, y: 10 })
    // Fixed on both axes, so the frame itself does not move or grow.
    expect(document.expectNode(frame.id).size).toEqual({ width: 300, height: 100 })
  })

  it('packs a column when the direction says so', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 100, height: 300 },
        layout: layout({ direction: 'vertical' }),
      }),
    )
    const a = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const b = document.insert(createRectangle({ size: { width: 60, height: 40 } }), frame.id)

    settle(document, frame.id)
    expect(placed(document, a)).toEqual({ x: 10, y: 10 })
    expect(placed(document, b)).toEqual({ x: 10, y: 70 })
  })

  it.each([
    ['start', 10, 10],
    ['center', 95, 10],
    ['end', 180, 10],
  ] as const)('aligns the main axis: %s', (mainAlign, firstX, firstY) => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout({ mainAlign }) }),
    )
    const a = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const b = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)

    settle(document, frame.id)
    expect(placed(document, a)).toEqual({ x: firstX, y: firstY })
    expect(placed(document, b).x).toBe(firstX + 60)
  })

  it('space-between spreads the free run into the gaps', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 320, height: 100 },
        layout: layout({ mainAlign: 'space-between' }),
      }),
    )
    const a = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const b = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const c = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)

    settle(document, frame.id)
    // 320 - 20 padding - 150 children - 20 gaps = 130 free, 65 extra per gap.
    expect(placed(document, a).x).toBe(10)
    expect(placed(document, b).x).toBe(135)
    expect(placed(document, c).x).toBe(260)
  })

  it.each([
    ['start', 10],
    ['center', 30],
    ['end', 50],
  ] as const)('aligns the cross axis: %s', (crossAlign, y) => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout({ crossAlign }) }),
    )
    const a = document.insert(createRectangle({ size: { width: 50, height: 40 } }), frame.id)

    settle(document, frame.id)
    expect(placed(document, a).y).toBe(y)
  })

  it('hugs both axes to the children plus padding and gaps', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 300, height: 100 },
        layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }),
      }),
    )
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    document.insert(createRectangle({ size: { width: 60, height: 40 } }), frame.id)

    settle(document, frame.id)
    expect(document.expectNode(frame.id).size).toEqual({ width: 140, height: 70 })
  })

  it('collapses an empty hug frame to its padding', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 300, height: 100 },
        layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }),
      }),
    )

    settle(document, frame.id)
    expect(document.expectNode(frame.id).size).toEqual({ width: 20, height: 20 })
  })

  it('resolves a nested hug chain bottom up', () => {
    const document = new SceneDocument()
    const outer = document.insert(
      createFrame({
        size: { width: 1, height: 1 },
        layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }),
      }),
    )
    const inner = document.insert(
      createFrame({
        size: { width: 1, height: 1 },
        layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }),
      }),
      outer.id,
    )
    document.insert(createRectangle({ size: { width: 50, height: 30 } }), inner.id)

    settle(document, outer.id)
    expect(document.expectNode(inner.id).size).toEqual({ width: 70, height: 50 })
    expect(document.expectNode(outer.id).size).toEqual({ width: 90, height: 70 })
  })

  it('shares the free main run equally among fill children', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const fillA = document.insert(
      createRectangle({
        size: { width: 5, height: 50 },
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )
    const fillB = document.insert(
      createRectangle({
        size: { width: 5, height: 50 },
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )

    settle(document, frame.id)
    // 300 - 20 padding - 20 gaps - 50 fixed = 210, so 105 each.
    expect(document.expectNode(fillA.id).size.width).toBe(105)
    expect(document.expectNode(fillB.id).size.width).toBe(105)
  })

  it('clamps a fill share at zero rather than going negative', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 60, height: 100 }, layout: layout() }),
    )
    document.insert(createRectangle({ size: { width: 100, height: 50 } }), frame.id)
    const fill = document.insert(
      createRectangle({
        size: { width: 30, height: 50 },
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )

    settle(document, frame.id)
    expect(document.expectNode(fill.id).size.width).toBe(0)
  })

  it('stretches a fill cross child to the frame minus padding', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    const fill = document.insert(
      createRectangle({
        size: { width: 50, height: 5 },
        layoutChild: { widthMode: 'fixed', heightMode: 'fill' },
      }),
      frame.id,
    )

    settle(document, frame.id)
    expect(document.expectNode(fill.id).size.height).toBe(80)
  })

  it('treats fill against a hug axis as fixed', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 300, height: 100 },
        layout: layout({ mainSizing: 'hug' }),
      }),
    )
    const fill = document.insert(
      createRectangle({
        size: { width: 40, height: 50 },
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )

    settle(document, frame.id)
    expect(document.expectNode(fill.id).size.width).toBe(40)
    expect(document.expectNode(frame.id).size.width).toBe(60)
  })

  it('assigns a fill width to text as a wrap width and takes the measured height', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 120, height: 300 }, layout: layout() }),
    )
    const text = document.insert(
      createText({
        characters: 'hello wide world',
        size: { width: 160, height: 20 },
        autoWidth: true,
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )

    const patches = computeLayout(document, frame.id, measurer)
    const patch = patchFor(patches, text.id)
    // 120 - 20 padding = 100 wrap width; 16 characters at 10 wide is 160, so two lines.
    expect(patch?.size).toEqual({ width: 100, height: 40 })
    expect(patch?.autoWidth).toBe(false)

    applyLayout(document, patches)
    expect(computeLayout(document, frame.id, measurer)).toEqual([])
  })

  it('keeps a text height it cannot measure yet', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 120, height: 300 }, layout: layout() }),
    )
    const text = document.insert(
      createText({
        characters: 'hello',
        size: { width: 160, height: 24 },
        autoWidth: true,
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )

    settle(document, frame.id, unmeasured)
    expect(document.expectNode(text.id).size).toEqual({ width: 100, height: 24 })
  })

  it('flows a rotated child by its bounds and ignores fill on it', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    const turned = document.insert(
      createRectangle({
        size: { width: 50, height: 20 },
        transform: rotation(Math.PI / 2),
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )
    const after = document.insert(createRectangle({ size: { width: 30, height: 30 } }), frame.id)

    settle(document, frame.id)
    // A quarter turn makes the 50x20 box occupy 20x50, and its AABB corner leads the origin
    // by 20, so the origin lands at slot + 20. Fill is ignored, so the size is untouched.
    expect(document.expectNode(turned.id).size).toEqual({ width: 50, height: 20 })
    expect(placed(document, turned)).toEqual({ x: 30, y: 10 })
    expect(placed(document, after).x).toBeCloseTo(40)
  })

  it('skips invisible children entirely', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 300, height: 100 },
        layout: layout({ mainSizing: 'hug' }),
      }),
    )
    const a = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const hidden = document.insert(
      createRectangle({ size: { width: 50, height: 50 }, visible: false }),
      frame.id,
    )
    const b = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)

    settle(document, frame.id)
    expect(placed(document, a).x).toBe(10)
    expect(placed(document, b).x).toBe(70)
    expect(patchFor(computeLayout(document, frame.id, measurer), hidden.id)).toBeUndefined()
    expect(document.expectNode(frame.id).size.width).toBe(130)
  })

  it('leaves an excluded child where it is and closes the flow around it', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    const a = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const dragged = document.insert(
      createRectangle({
        size: { width: 50, height: 50 },
        transform: translation(500, 500),
      }),
      frame.id,
    )
    const b = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)

    const exclude = new Set([dragged.id])
    applyLayout(document, computeLayout(document, frame.id, measurer, exclude))
    expect(placed(document, a).x).toBe(10)
    expect(placed(document, b).x).toBe(70)
    expect(placed(document, dragged)).toEqual({ x: 500, y: 500 })
  })

  it('holds a hug frame at its size while a child is out of the flow', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 0, height: 0 }, layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }) }),
    )
    const dragged = document.insert(
      createRectangle({ size: { width: 110, height: 20 } }),
      frame.id,
    )
    const other = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    settle(document, frame.id)
    const before = { ...document.expectNode(frame.id).size }
    expect(before).toEqual({ width: 190, height: 70 })

    // The first move of a drag: the node floats, so it leaves the flow.
    const exclude = new Set([dragged.id])
    applyLayout(document, computeLayout(document, frame.id, measurer, exclude))

    // The sibling closes up, but the frame is not what changed and must not collapse onto it.
    expect(document.expectNode(frame.id).size).toEqual(before)
    expect(placed(document, other).x).toBe(10)
  })

  it('lets a hug frame settle onto what is left once the drag releases', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 0, height: 0 }, layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }) }),
    )
    const dragged = document.insert(
      createRectangle({ size: { width: 110, height: 20 } }),
      frame.id,
    )
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    settle(document, frame.id)

    applyLayout(document, computeLayout(document, frame.id, measurer, new Set([dragged.id])))
    document.remove(dragged.id)
    // The release pass runs without the exclusion, which is what lets the size catch up.
    settle(document, frame.id)
    expect(document.expectNode(frame.id).size).toEqual({ width: 70, height: 70 })
  })

  it('holds the axes that hug and leaves a fixed one alone', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 300, height: 0 },
        layout: layout({ mainSizing: 'fixed', crossSizing: 'hug' }),
      }),
    )
    const dragged = document.insert(
      createRectangle({ size: { width: 50, height: 80 } }),
      frame.id,
    )
    document.insert(createRectangle({ size: { width: 50, height: 30 } }), frame.id)
    settle(document, frame.id)
    expect(document.expectNode(frame.id).size).toEqual({ width: 300, height: 100 })

    applyLayout(document, computeLayout(document, frame.id, measurer, new Set([dragged.id])))
    expect(document.expectNode(frame.id).size).toEqual({ width: 300, height: 100 })
  })

  it('holds a hug frame around a text child, which is where it reads worst', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 0, height: 0 }, layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }) }),
    )
    const text = document.insert(
      createText({ characters: 'hello world', size: { width: 110, height: 20 } }),
      frame.id,
    )
    settle(document, frame.id)
    const before = { ...document.expectNode(frame.id).size }

    applyLayout(document, computeLayout(document, frame.id, measurer, new Set([text.id])))
    // The only child, so without the hold the frame would collapse to its padding.
    expect(document.expectNode(frame.id).size).toEqual(before)
  })

  it('frees the frame a node has been dragged out of, since it holds nothing', () => {
    const document = new SceneDocument()
    const from = document.insert(
      createFrame({ size: { width: 0, height: 0 }, layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }) }),
    )
    const moved = document.insert(createRectangle({ size: { width: 110, height: 20 } }), from.id)
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), from.id)
    settle(document, from.id)

    // Live reparent out: the node is no longer this frame's child, so the hold lifts.
    document.reparent(moved.id, document.rootId)
    applyLayout(document, computeLayout(document, from.id, measurer, new Set([moved.id])))
    expect(document.expectNode(from.id).size).toEqual({ width: 70, height: 70 })
  })

  it('returns nothing for a frame without auto layout', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ size: { width: 300, height: 100 } }))
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)

    expect(computeLayout(document, frame.id, measurer)).toEqual([])
  })
})

describe('layoutRootsFor', () => {
  it('finds nothing in a document without auto layout', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({}))
    const rect = document.insert(createRectangle({}), frame.id)

    expect(layoutRootsFor(document, [rect.id])).toEqual([])
  })

  it('climbs from a child to the topmost auto layout ancestor', () => {
    const document = new SceneDocument()
    const outer = document.insert(createFrame({ layout: layout() }))
    const inner = document.insert(createFrame({ layout: layout() }), outer.id)
    const rect = document.insert(createRectangle({}), inner.id)

    expect(layoutRootsFor(document, [rect.id])).toEqual([outer.id])
    expect(layoutRootsFor(document, [inner.id])).toEqual([outer.id])
    expect(layoutRootsFor(document, [rect.id, inner.id])).toEqual([outer.id])
  })

  it('stops climbing at a plain frame between two auto ones', () => {
    const document = new SceneDocument()
    const top = document.insert(createFrame({ layout: layout() }))
    const plain = document.insert(createFrame({}), top.id)
    const auto = document.insert(createFrame({ layout: layout() }), plain.id)
    const rect = document.insert(createRectangle({}), auto.id)

    // The plain frame's size does not follow its children, so the chain is severed there.
    expect(layoutRootsFor(document, [rect.id])).toEqual([auto.id])
  })

  it('drops a root that another root already contains', () => {
    const document = new SceneDocument()
    const outer = document.insert(createFrame({ layout: layout() }))
    const inner = document.insert(createFrame({ layout: layout() }), outer.id)
    const rect = document.insert(createRectangle({}), inner.id)
    const loose = document.insert(createFrame({ layout: layout() }))
    const looseChild = document.insert(createRectangle({}), loose.id)

    const roots = layoutRootsFor(document, [rect.id, outer.id, looseChild.id])
    expect(new Set(roots)).toEqual(new Set([outer.id, loose.id]))
  })
})

describe('insertionIndex', () => {
  function rowFixture(): { document: SceneDocument; frame: SceneNode; dragged: SceneNode } {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const dragged = document.insert(
      createRectangle({ size: { width: 50, height: 50 } }),
      frame.id,
    )
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    applyLayout(document, computeLayout(document, frame.id, measurer))
    return { document, frame, dragged }
  }

  it('walks the slots as the pointer crosses each midpoint', () => {
    const { document, frame } = rowFixture()
    // Children sit at 10, 70, 130, so midpoints are 35, 95, 155.
    expect(insertionIndex(document, frame.id, { x: 0, y: 50 })).toBe(0)
    expect(insertionIndex(document, frame.id, { x: 60, y: 50 })).toBe(1)
    expect(insertionIndex(document, frame.id, { x: 120, y: 50 })).toBe(2)
    expect(insertionIndex(document, frame.id, { x: 290, y: 50 })).toBe(3)
  })

  it('indexes into the array with the excluded node removed', () => {
    const { document, frame, dragged } = rowFixture()
    const exclude = new Set([dragged.id])
    expect(insertionIndex(document, frame.id, { x: 0, y: 50 }, exclude)).toBe(0)
    expect(insertionIndex(document, frame.id, { x: 60, y: 50 }, exclude)).toBe(1)
    expect(insertionIndex(document, frame.id, { x: 290, y: 50 }, exclude)).toBe(2)
  })
})

describe('inferLayout', () => {
  it('reads direction, gap, padding and flow order off the existing children', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ size: { width: 200, height: 100 } }))
    // Inserted out of visual order on purpose.
    const right = document.insert(
      createRectangle({ size: { width: 60, height: 50 }, transform: translation(70, 10) }),
      frame.id,
    )
    const left = document.insert(
      createRectangle({ size: { width: 50, height: 50 }, transform: translation(10, 10) }),
      frame.id,
    )

    const inferred = inferLayout(document, frame.id)
    expect(inferred.layout.direction).toBe('horizontal')
    expect(inferred.layout.gap).toBe(10)
    expect(inferred.layout.padding).toEqual({ top: 10, right: 70, bottom: 40, left: 10 })
    expect(inferred.layout.mainSizing).toBe('fixed')
    expect(inferred.childOrder).toEqual([left.id, right.id])

    // The inferred layout reproduces the existing positions, so enabling it moves nothing
    // once the children are in flow order.
    document.transact(() => {
      document.update<FrameNode>(frame.id, { layout: inferred.layout })
      inferred.childOrder.forEach((id, index) => document.reorder(id, index))
    })
    expect(computeLayout(document, frame.id, measurer)).toEqual([])
  })

  it('falls back to defaults for an empty frame', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ size: { width: 200, height: 100 } }))

    const inferred = inferLayout(document, frame.id)
    expect(inferred.layout.gap).toBe(10)
    expect(inferred.layout.padding).toEqual({ top: 10, right: 10, bottom: 10, left: 10 })
    expect(inferred.childOrder).toEqual([])
  })
})

/*
 * `plain` gates fill sizing, and it used to read `near(t.a, 1) && near(t.d, 1)`, which a flip
 * fails outright since `reflectAbout` leaves one of them at exactly -1. That silently
 * downgraded a flipped fill child to fixed, the fate a rotated child gets deliberately. A flip
 * is neither a rotation nor a skew: the node's axes are still the frame's axes, only pointing
 * the other way, so there is no reason it should forfeit fill.
 */
describe('a flipped auto layout child', () => {
  it('still fills its parent, unlike a rotated one', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    const flipped = document.insert(
      createRectangle({
        size: { width: 40, height: 50 },
        transform: reflectAbout({ x: 20, y: 25 }, 'horizontal'),
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )

    // Frame minus padding is 280, all of it going to the one fill child.
    expect(computeLayout(document, frame.id, unmeasured).find((p) => p.id === flipped.id)?.size)
      .toEqual({ width: 280, height: 50 })

    settle(document, frame.id, unmeasured)
  })

  it('keeps mirroring the child in place: only tx and ty change, never a or d', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    const mirror = reflectAbout({ x: 20, y: 25 }, 'horizontal')
    const flipped = document.insert(
      createRectangle({
        size: { width: 40, height: 50 },
        transform: mirror,
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )

    settle(document, frame.id, unmeasured)

    const after = document.expectNode(flipped.id).transform
    expect({ a: after.a, b: after.b, c: after.c, d: after.d }).toEqual({
      a: mirror.a,
      b: mirror.b,
      c: mirror.c,
      d: mirror.d,
    })
  })
})
