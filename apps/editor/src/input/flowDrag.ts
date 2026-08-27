import {
  applyToPoint,
  containerAt,
  insertionIndex,
  invert,
  isAutoLayoutFrame,
  type Mat2D,
  type NodeId,
  type SceneDocument,
  type Vec2,
} from '@canvas/document'
import { relayout } from '../state/autoLayout'
import type { Drag, DraggedNode } from './dragState'

const IDENTITY_MATRIX: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

/** Everything needed to move a set of nodes with the pointer, resolved once at grab time. */
export function draggedNodesFor(
  document: SceneDocument,
  ids: readonly NodeId[],
  world: Vec2,
): DraggedNode[] {
  return ids.flatMap((id) => {
    const node = document.getNode(id)
    if (!node || node.locked) return []
    const parentInverse = invert(
      node.parent ? document.worldTransform(node.parent) : IDENTITY_MATRIX,
    )
    return [
      {
        id,
        parentInverse,
        startTransform: { ...node.transform },
        startLocal: applyToPoint(parentInverse, world),
        origin: {
          parent: node.parent,
          index: document.indexOf(id),
          transform: { ...node.transform },
        },
      },
    ]
  })
}

/**
 * The same node re-anchored against its parent of the moment, after a live reparent.
 *
 * The pointer's world offset from the node is unchanged, so recapturing both sides of the
 * subtraction at the same instant keeps the node exactly where it was under the cursor.
 * `origin` is deliberately carried over untouched: it is the cancel's, not the drag's.
 */
export function rebasedNode(
  document: SceneDocument,
  dragged: DraggedNode,
  world: Vec2,
): DraggedNode {
  const node = document.expectNode(dragged.id)
  const parentInverse = invert(
    node.parent ? document.worldTransform(node.parent) : IDENTITY_MATRIX,
  )
  return {
    ...dragged,
    parentInverse,
    startTransform: { ...node.transform },
    startLocal: applyToPoint(parentInverse, world),
  }
}

/** Puts every dragged node where the pointer says, in one wake of the panels. */
export function moveNodes(
  document: SceneDocument,
  nodes: readonly DraggedNode[],
  world: Vec2,
): void {
  // One transaction, so moving twenty nodes wakes the panels once rather than twenty times.
  // The history group the gesture opened then folds every frame into a single undo step.
  document.transact(() => {
    for (const dragged of nodes) {
      const local = applyToPoint(dragged.parentInverse, world)
      document.update(dragged.id, {
        transform: {
          ...dragged.startTransform,
          tx: dragged.startTransform.tx + (local.x - dragged.startLocal.x),
          ty: dragged.startTransform.ty + (local.y - dragged.startLocal.y),
        },
      })
    }
  })
}

/**
 * Keeps a single dragged node honest against auto layout while it moves.
 *
 * Entering an auto layout frame parents the node there at once and opens a slot at the
 * pointer; moving along the frame slides the slot; leaving hands the node to whatever is
 * under the pointer, so the flow closes behind it. Every layout pass excludes the dragged
 * node, which is what lets it float with the pointer while only the siblings shift; the
 * release runs one pass without the exclusion and that is what snaps it in.
 *
 * A multiple selection has no single slot to hold open, so it keeps the drop-on-release
 * path untouched.
 */
export function applyFlow(document: SceneDocument, current: Drag, world: Vec2): void {
  if (current.nodes.length !== 1) return
  const dragged = current.nodes[0]
  if (!dragged) return
  const node = document.getNode(dragged.id)
  if (!node) return

  const exclude = new Set([dragged.id])
  const target = containerAt(document, world, exclude)
  if (document.isAncestorOf(dragged.id, target.id)) return

  if (isAutoLayoutFrame(document.getNode(target.id))) {
    const previous = node.parent
    document.transact(() => {
      if (node.parent !== target.id) {
        document.reparent(dragged.id, target.id)
        current.nodes = [rebasedNode(document, dragged, world)]
      }
      const local = applyToPoint(invert(document.worldTransform(target.id)), world)
      const slot = insertionIndex(document, target.id, local, exclude)
      if (document.indexOf(dragged.id) !== slot) document.reorder(dragged.id, slot)
      relayout(
        document,
        previous && previous !== target.id ? [dragged.id, previous] : [dragged.id],
        exclude,
      )
    })
    current.reorderFrame = target.id
    return
  }

  if (current.reorderFrame) {
    const previous = node.parent
    document.transact(() => {
      if (node.parent !== target.id) {
        document.reparent(dragged.id, target.id)
        current.nodes = [rebasedNode(document, dragged, world)]
      }
      if (previous) relayout(document, [previous], exclude)
    })
    current.reorderFrame = undefined
  }
}
