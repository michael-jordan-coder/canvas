import type { NodeId, Rect, SceneDocument } from '@canvas/document'
import { relayout } from '../state/autoLayout'
import { applyRotation } from '../state/rotate'
import type { Drag } from './dragState'

export interface CancelEffects {
  setSelection: (ids: readonly NodeId[]) => void
  setMarquee: (rect: Rect | null) => void
}

/**
 * Restores live document state to what it was before the cancelled gesture, undoing only
 * what that gesture itself did. `pan` is deliberately not handled: it is view state, never
 * touches the document or history, and releasing the pointer already ends it cleanly.
 *
 * Wherever this removes nodes it also puts the selection back, the same way `deleteSelection`
 * does: leaving it pointing at an id that no longer exists shows no handles and no properties
 * while still reading as a selection, so delete and nudge silently do nothing afterwards.
 */
export function cancelDrag(
  document: SceneDocument,
  current: Drag,
  effects: CancelEffects,
): void {
  if (current.kind === 'move' && current.grouped) {
    const duplicatedFrom = current.duplicatedFrom
    document.transact(() => {
      const parents: NodeId[] = []
      for (const dragged of current.nodes) {
        // An option drag copy has no meaningful "before": it did not exist until this
        // gesture created it, so cancelling removes it rather than trying to restore it.
        if (duplicatedFrom) {
          const parent = document.getNode(dragged.id)?.parent
          if (parent) parents.push(parent)
          document.remove(dragged.id)
          continue
        }
        // The gesture may have reparented or reordered the node live on its way through
        // an auto layout frame, so the cancel walks it all the way back: parent first,
        // then place among the siblings, then the transform, which `origin` holds in the
        // original parent's space.
        const node = document.getNode(dragged.id)
        if (!node) continue
        if (node.parent) parents.push(node.parent)
        if (dragged.origin.parent && node.parent !== dragged.origin.parent) {
          document.reparent(dragged.id, dragged.origin.parent, dragged.origin.index)
          parents.push(dragged.origin.parent)
        } else if (document.indexOf(dragged.id) !== dragged.origin.index) {
          document.reorder(dragged.id, dragged.origin.index)
        }
        document.update(dragged.id, { transform: dragged.origin.transform })
      }
      // Deterministic and idempotent, so re-running the layout over the restored inputs
      // lands the siblings exactly where the gesture found them.
      relayout(document, [...current.nodes.map((dragged) => dragged.id), ...parents])
      // The originals never moved, so reselecting them leaves the gesture with no trace.
      if (duplicatedFrom) effects.setSelection(duplicatedFrom)
    })
  } else if (current.kind === 'resize' && current.grouped) {
    if (current.localResize) {
      const { id, startTransform, startSize, startLayout, startLayoutChild } = current.localResize
      const node = document.getNode(id)
      document.transact(() => {
        document.update(id, {
          transform: startTransform,
          size: startSize,
          // Only put back what the gesture could have taken: a node that never had the
          // field must not gain a key holding undefined.
          ...(node?.type === 'frame' && node.layout ? { layout: startLayout } : {}),
          ...(node?.layoutChild ? { layoutChild: startLayoutChild } : {}),
        })
        relayout(document, [id])
      })
    } else if (current.resizing) {
      document.transact(() => {
        for (const target of current.resizing ?? []) {
          document.update(target.id, { transform: target.startTransform, size: target.startSize })
        }
        relayout(document, (current.resizing ?? []).map((target) => target.id))
      })
    }
  } else if (current.kind === 'rotate' && current.grouped && current.rotating && current.pivot) {
    // A zero delta recomputes each node's transform back through the same maths that moved
    // it, landing exactly on where it started.
    applyRotation(document, current.rotating, 0, current.pivot)
  } else if (current.kind === 'create' && current.created) {
    const created = current.created
    document.transact(() => {
      document.remove(created)
      effects.setSelection(current.startSelection ?? [])
    })
  } else if (current.kind === 'marquee') {
    effects.setSelection(current.marqueeBase ?? [])
    effects.setMarquee(null)
  }

  if (current.grouped) document.abortHistoryGroup()
}
