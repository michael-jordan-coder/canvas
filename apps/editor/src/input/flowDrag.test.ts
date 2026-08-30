import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  applyToPoint,
  createFrame,
  createRectangle,
  defaultFrameLayout,
  translation,
  type SceneNode,
  type Vec2,
} from '@canvas/document'
import { DEFAULT_CAMERA } from '@canvas/renderer'
import { relayout } from '../state/autoLayout'
import type { Drag } from './dragState'
import { applyFlow, draggedNodesFor, moveNodes, rebasedNode } from './flowDrag'

function moveDrag(document: SceneDocument, node: SceneNode, world: Vec2): Drag {
  return {
    pointerId: 1,
    kind: 'move',
    startScreen: { x: 0, y: 0 },
    startWorld: world,
    startCamera: DEFAULT_CAMERA,
    nodes: draggedNodesFor(document, [node.id], world),
    grouped: true,
    duplicateOnMove: false,
  }
}

/** An auto layout row at the origin with two 50 by 50 children, settled. */
function row() {
  const document = new SceneDocument()
  const frame = document.insert(
    createFrame({ size: { width: 300, height: 100 }, layout: defaultFrameLayout('horizontal') }),
  )
  const a = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
  const b = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
  relayout(document, [frame.id])
  document.clearHistory()
  return { document, frame, a, b }
}

const worldPosition = (document: SceneDocument, node: SceneNode): Vec2 =>
  applyToPoint(document.worldTransform(node.id), { x: 0, y: 0 })

describe('draggedNodesFor', () => {
  it('captures where the gesture found the node, for Escape', () => {
    const { document, frame, b } = row()
    const [dragged] = draggedNodesFor(document, [b.id], { x: 0, y: 0 })
    expect(dragged?.origin.parent).toBe(frame.id)
    expect(dragged?.origin.index).toBe(1)
    expect(dragged?.origin.transform).toEqual(b.transform)
  })

  it('leaves a locked node out entirely', () => {
    const { document, a } = row()
    document.update(a.id, { locked: true })
    expect(draggedNodesFor(document, [a.id], { x: 0, y: 0 })).toHaveLength(0)
  })
})

describe('moveNodes', () => {
  it('moves by the pointer delta, in the parent units the node stores', () => {
    const document = new SceneDocument()
    const node = document.insert(
      createRectangle({ transform: translation(10, 20), size: { width: 40, height: 40 } }),
    )
    const nodes = draggedNodesFor(document, [node.id], { x: 30, y: 40 })

    moveNodes(document, nodes, { x: 130, y: 90 })

    expect(document.expectNode(node.id).transform).toEqual(translation(110, 70))
  })
})

describe('applyFlow', () => {
  it('entering an auto frame reparents live and opens a slot at the pointer', () => {
    const { document, frame } = row()
    const loose = document.insert(
      createRectangle({ transform: translation(600, 300), size: { width: 50, height: 50 } }),
    )
    relayout(document, [loose.id])

    // Over the far right of the row, past both children.
    const world = { x: 250, y: 30 }
    const drag = moveDrag(document, loose, world)
    applyFlow(document, drag, world)

    expect(document.expectNode(loose.id).parent).toBe(frame.id)
    expect(drag.reorderFrame).toBe(frame.id)
    expect(document.indexOf(loose.id)).toBe(2)
  })

  it('moving along the frame slides the slot', () => {
    const { document, frame } = row()
    const loose = document.insert(
      createRectangle({ transform: translation(600, 300), size: { width: 50, height: 50 } }),
    )
    relayout(document, [loose.id])

    const right = { x: 250, y: 30 }
    const drag = moveDrag(document, loose, right)
    applyFlow(document, drag, right)
    expect(document.indexOf(loose.id)).toBe(2)

    // Back to the very start of the row.
    applyFlow(document, drag, { x: 12, y: 30 })
    expect(document.expectNode(loose.id).parent).toBe(frame.id)
    expect(document.indexOf(loose.id)).toBe(0)
  })

  it('floats the dragged node while the siblings shift around the slot', () => {
    const { document, frame, a, b } = row()
    const positionsBefore = {
      a: worldPosition(document, a),
      b: worldPosition(document, b),
    }

    // Dragging child a toward the far end of the row.
    const world = { x: 250, y: 30 }
    const drag = moveDrag(document, a, world)
    moveNodes(document, drag.nodes, world)
    const floated = { ...document.expectNode(a.id).transform }
    applyFlow(document, drag, world)

    // The flow pass excluded the dragged node, so the pointer still owns its transform.
    expect(document.expectNode(a.id).transform).toEqual(floated)
    expect(drag.reorderFrame).toBe(frame.id)
    // Its sibling closed over the opened slot: with a floating, b takes the first place.
    const after = worldPosition(document, b)
    expect(after.x).toBeCloseTo(positionsBefore.a.x, 6)
    expect(after.y).toBeCloseTo(positionsBefore.a.y, 6)
  })

  it('leaving the frame hands the node to what is under the pointer', () => {
    const { document, frame } = row()
    const loose = document.insert(
      createRectangle({ transform: translation(600, 300), size: { width: 50, height: 50 } }),
    )
    relayout(document, [loose.id])

    const inside = { x: 250, y: 30 }
    const drag = moveDrag(document, loose, inside)
    applyFlow(document, drag, inside)
    expect(document.expectNode(loose.id).parent).toBe(frame.id)

    // Off the frame onto empty canvas.
    const outside = { x: 700, y: 500 }
    moveNodes(document, drag.nodes, outside)
    applyFlow(document, drag, outside)

    expect(document.expectNode(loose.id).parent).toBe(document.rootId)
    expect(drag.reorderFrame).toBeUndefined()
  })

  it('refuses to drop a node into its own descendant', () => {
    const document = new SceneDocument()
    const outer = document.insert(createFrame({ size: { width: 400, height: 400 } }))
    const inner = document.insert(
      createFrame({
        transform: translation(50, 50),
        size: { width: 300, height: 100 },
        layout: defaultFrameLayout('horizontal'),
      }),
      outer.id,
    )
    relayout(document, [inner.id])
    document.clearHistory()
    const version = document.version

    // The pointer sits over the inner auto frame while its own ancestor is what drags.
    const world = { x: 100, y: 100 }
    const drag = moveDrag(document, document.expectNode(outer.id), world)
    applyFlow(document, drag, world)

    expect(document.expectNode(inner.id).parent).toBe(outer.id)
    expect(document.expectNode(outer.id).parent).toBe(document.rootId)
    expect(document.version).toBe(version)
  })

  it('keeps a multiple selection out of the flow entirely', () => {
    const { document, frame } = row()
    const one = document.insert(createRectangle({ size: { width: 20, height: 20 } }))
    const two = document.insert(createRectangle({ size: { width: 20, height: 20 } }))

    const world = { x: 150, y: 30 }
    const drag = moveDrag(document, one, world)
    drag.nodes = draggedNodesFor(document, [one.id, two.id], world)
    applyFlow(document, drag, world)

    expect(document.expectNode(one.id).parent).toBe(document.rootId)
    expect(drag.reorderFrame).toBeUndefined()
    void frame
  })
})

describe('rebasedNode', () => {
  it('keeps the node exactly under the cursor across a reparent, and origin untouched', () => {
    const { document, frame } = row()
    const loose = document.insert(
      createRectangle({ transform: translation(600, 300), size: { width: 50, height: 50 } }),
    )
    const world = { x: 250, y: 30 }
    const [dragged] = draggedNodesFor(document, [loose.id], world)
    const before = worldPosition(document, document.expectNode(loose.id))

    document.reparent(loose.id, frame.id)
    const rebased = rebasedNode(document, dragged!, world)

    // Same world position on both sides of the reparent.
    const after = worldPosition(document, document.expectNode(loose.id))
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    // The cancel's record still names the true beginning.
    expect(rebased.origin.parent).toBe(document.rootId)
    expect(rebased.origin.transform).toEqual(translation(600, 300))
    // While the drag's own frame of reference moved with the new parent.
    expect(rebased.startTransform).toEqual(document.expectNode(loose.id).transform)
  })
})
