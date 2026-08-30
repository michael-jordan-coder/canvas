import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createFrame,
  createRectangle,
  defaultFrameLayout,
  invert,
  translation,
  type Mat2D,
  type FrameNode,
  type NodeId,
  type Rect,
  type SceneNode,
} from '@canvas/document'
import { DEFAULT_CAMERA } from '@canvas/renderer'
import { relayout } from '../state/autoLayout'
import { applyRotation, rotateTargetsFor, worldCentre } from '../state/rotate'
import { cancelDrag, type CancelEffects } from './cancelDrag'
import type { Drag, DraggedNode } from './dragState'

const IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

/** The fields every Drag carries, with the gesture past its slop. */
function baseDrag(kind: Drag['kind']): Drag {
  return {
    pointerId: 1,
    kind,
    startScreen: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
    startCamera: DEFAULT_CAMERA,
    nodes: [],
    grouped: true,
    duplicateOnMove: false,
  }
}

function draggedNode(document: SceneDocument, node: SceneNode): DraggedNode {
  return {
    id: node.id,
    parentInverse: invert(
      node.parent ? document.worldTransform(node.parent) : IDENTITY,
    ),
    startTransform: { ...node.transform },
    startLocal: { x: 0, y: 0 },
    origin: {
      parent: node.parent,
      index: document.indexOf(node.id),
      transform: { ...node.transform },
    },
  }
}

/** Records what the cancel puts back, standing in for the UI store. */
function effects(): CancelEffects & { selection: readonly NodeId[] | null; marquee: Rect | null } {
  const record = {
    selection: null as readonly NodeId[] | null,
    marquee: null as Rect | null,
    setSelection(ids: readonly NodeId[]) {
      record.selection = ids
    },
    setMarquee(rect: Rect | null) {
      record.marquee = rect
    },
  }
  return record
}

describe('cancelDrag: move', () => {
  it('restores parent, index and transform past a live reparent', () => {
    const document = new SceneDocument()
    const home = document.insert(createFrame({ size: { width: 200, height: 200 } }))
    const other = document.insert(
      createFrame({ transform: translation(400, 0), size: { width: 200, height: 200 } }),
    )
    const sibling = document.insert(createRectangle({ size: { width: 20, height: 20 } }), home.id)
    const node = document.insert(
      createRectangle({ transform: translation(50, 50), size: { width: 20, height: 20 } }),
      home.id,
    )
    document.clearHistory()

    const drag = baseDrag('move')
    drag.nodes = [draggedNode(document, node)]

    // The gesture: past the slop the group opens, the node moves, then wanders into the
    // other frame, exactly the sequence the pointer layer performs.
    document.beginHistoryGroup()
    document.update(node.id, { transform: translation(500, 80) })
    document.reparent(node.id, other.id)

    cancelDrag(document, drag, effects())

    const restored = document.expectNode(node.id)
    expect(restored.parent).toBe(home.id)
    expect(document.indexOf(node.id)).toBe(1)
    expect(restored.transform).toEqual(translation(50, 50))
    // The sibling never moved and the cancel must not have touched it.
    expect(document.expectNode(sibling.id).transform).toEqual(IDENTITY)
  })

  it('lands auto layout siblings back where the gesture found them', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: defaultFrameLayout('horizontal') }),
    )
    const a = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    const b = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    relayout(document, [frame.id])
    document.clearHistory()
    const before = { a: { ...document.expectNode(a.id).transform }, b: { ...document.expectNode(b.id).transform } }

    const drag = baseDrag('move')
    drag.nodes = [draggedNode(document, a)]

    document.beginHistoryGroup()
    // Dragged out of the frame onto the page, so the flow closed behind it.
    document.update(a.id, { transform: translation(600, 300) })
    document.reparent(a.id, document.rootId)
    relayout(document, [a.id, frame.id])

    cancelDrag(document, drag, effects())

    expect(document.expectNode(a.id).parent).toBe(frame.id)
    expect(document.expectNode(a.id).transform).toEqual(before.a)
    expect(document.expectNode(b.id).transform).toEqual(before.b)
  })

  it('removes the copies of an option drag and reselects the originals', () => {
    const document = new SceneDocument()
    const original = document.insert(createRectangle({ size: { width: 20, height: 20 } }))
    const copy = document.insert(createRectangle({ size: { width: 20, height: 20 } }))
    document.clearHistory()

    const drag = baseDrag('move')
    drag.duplicatedFrom = [original.id]
    drag.nodes = [draggedNode(document, copy)]

    document.beginHistoryGroup()
    document.update(copy.id, { transform: translation(100, 0) })

    const record = effects()
    cancelDrag(document, drag, record)

    expect(document.getNode(copy.id)).toBeUndefined()
    expect(document.getNode(original.id)).toBeDefined()
    expect(record.selection).toEqual([original.id])
  })
})

describe('cancelDrag: resize', () => {
  it('restores transform and size, and layout only where the node had one', () => {
    const document = new SceneDocument()
    const layout = { ...defaultFrameLayout('horizontal'), mainSizing: 'hug' as const }
    const frame = document.insert(createFrame({ layout }))
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    // Settled first, the way a real document is when a handle is grabbed: the cancel ends
    // with a relayout, and only a settled start is a fixed point of the engine.
    relayout(document, [frame.id])
    document.clearHistory()
    const startSize = { ...document.expectNode(frame.id).size }
    const startLayout = { ...layout, padding: { ...layout.padding } }

    const drag = baseDrag('resize')
    drag.localResize = {
      id: frame.id,
      worldInverse: invert(document.worldTransform(frame.id)),
      startTransform: { ...frame.transform },
      startSize,
      startLayout,
    }

    document.beginHistoryGroup()
    // The gesture grew the frame and flipped its hug axis to fixed.
    document.update<FrameNode>(frame.id, {
      size: { width: 200, height: startSize.height },
      layout: { ...layout, mainSizing: 'fixed' },
    })
    relayout(document, [frame.id])

    cancelDrag(document, drag, effects())

    const restored = document.expectNode(frame.id)
    expect(restored.size).toEqual(startSize)
    expect(restored.type === 'frame' && restored.layout?.mainSizing).toBe('hug')
  })

  it('restores every node of a world aligned resize', () => {
    const document = new SceneDocument()
    const a = document.insert(createRectangle({ size: { width: 40, height: 40 } }))
    const b = document.insert(
      createRectangle({ transform: translation(100, 0), size: { width: 40, height: 40 } }),
    )
    document.clearHistory()

    const drag = baseDrag('resize')
    drag.resizing = [a, b].map((node) => ({
      id: node.id,
      parentInverse: IDENTITY,
      startTransform: { ...node.transform },
      startSize: { ...node.size },
    }))

    document.beginHistoryGroup()
    document.update(a.id, { size: { width: 80, height: 80 } })
    document.update(b.id, { transform: translation(200, 0), size: { width: 80, height: 80 } })

    cancelDrag(document, drag, effects())

    expect(document.expectNode(a.id).size).toEqual({ width: 40, height: 40 })
    expect(document.expectNode(b.id).transform).toEqual(translation(100, 0))
    expect(document.expectNode(b.id).size).toEqual({ width: 40, height: 40 })
  })
})

describe('cancelDrag: rotate', () => {
  it('lands exactly on the starting transform', () => {
    const document = new SceneDocument()
    const node = document.insert(createRectangle({ size: { width: 100, height: 60 } }))
    document.clearHistory()
    const before = { ...node.transform }

    const drag = baseDrag('rotate')
    drag.pivot = worldCentre(document, node.id)!
    drag.rotating = rotateTargetsFor(document, [node.id])

    document.beginHistoryGroup()
    applyRotation(document, drag.rotating, Math.PI / 5, drag.pivot)

    cancelDrag(document, drag, effects())

    const restored = document.expectNode(node.id).transform
    expect(restored.a).toBeCloseTo(before.a, 10)
    expect(restored.b).toBeCloseTo(before.b, 10)
    expect(restored.tx).toBeCloseTo(before.tx, 10)
    expect(restored.ty).toBeCloseTo(before.ty, 10)
  })
})

describe('cancelDrag: create and marquee', () => {
  it('removes the created node and puts the previous selection back', () => {
    const document = new SceneDocument()
    const existing = document.insert(createRectangle({ size: { width: 20, height: 20 } }))
    document.clearHistory()

    const drag = baseDrag('create')
    drag.startSelection = [existing.id]

    document.beginHistoryGroup()
    const created = document.insert(createRectangle({ size: { width: 50, height: 50 } }))
    drag.created = created.id

    const record = effects()
    cancelDrag(document, drag, record)

    expect(document.getNode(created.id)).toBeUndefined()
    expect(record.selection).toEqual([existing.id])
  })

  it('restores the marquee base and clears the rubber band', () => {
    const document = new SceneDocument()
    const node = document.insert(createRectangle({ size: { width: 20, height: 20 } }))
    document.clearHistory()

    const drag = baseDrag('marquee')
    drag.grouped = false
    drag.marqueeBase = [node.id]

    const record = effects()
    record.marquee = { x: 0, y: 0, width: 10, height: 10 }
    cancelDrag(document, drag, record)

    expect(record.selection).toEqual([node.id])
    expect(record.marquee).toBeNull()
  })
})

describe('cancelDrag: history', () => {
  it('leaves no step behind, so undo has nothing to give back', () => {
    const document = new SceneDocument()
    const node = document.insert(createRectangle({ size: { width: 20, height: 20 } }))
    document.clearHistory()
    expect(document.historyDepth).toBe(0)

    const drag = baseDrag('move')
    drag.nodes = [draggedNode(document, node)]

    document.beginHistoryGroup()
    document.update(node.id, { transform: translation(300, 0) })

    cancelDrag(document, drag, effects())

    expect(document.historyDepth).toBe(0)
    expect(document.canUndo).toBe(false)
    expect(document.expectNode(node.id).transform).toEqual(IDENTITY)
  })
})
