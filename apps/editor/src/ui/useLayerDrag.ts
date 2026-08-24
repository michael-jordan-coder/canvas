import { useCallback, useRef, useState } from 'react'
import { acceptsManualChildren, type NodeId } from '@canvas/document'
import { relayout } from '../state/autoLayout'
import { scene } from '../state/scene'
import { useUI } from '../state/uiStore'

/** Where a drop would land. `into` means inside a container, the others mean beside a node. */
export type DropPosition = 'before' | 'after' | 'into'

export interface DropTarget {
  id: NodeId
  position: DropPosition
}

export interface LayerDrag {
  dragging: NodeId | null
  target: DropTarget | null
  start: (id: NodeId, event: React.PointerEvent) => void
}

/** Pointer travel before a press counts as a drag rather than a click. */
const THRESHOLD = 4
/** Fraction of a row's height at each end that means "beside" rather than "inside". */
const EDGE = 0.3

function targetUnder(clientX: number, clientY: number, dragged: NodeId): DropTarget | null {
  const element = document.elementFromPoint(clientX, clientY)
  const row = element?.closest('[data-layer-id]')
  if (!(row instanceof HTMLElement)) return null

  const id = row.dataset['layerId'] as NodeId | undefined
  if (!id || id === dragged) return null
  // Dropping a node inside its own subtree would detach it from the tree.
  if (scene.isAncestorOf(dragged, id)) return null

  const box = row.getBoundingClientRect()
  const offset = (clientY - box.top) / box.height
  const node = scene.getNode(id)
  if (!node) return null
  // No drop anywhere among a code node's output: "into" would hand it a child it does not
  // own, and "before"/"after" a generated row is the same insert wearing a different name.
  if (node.sourceKey !== undefined) return null
  const container = acceptsManualChildren(node)

  if (offset < EDGE) return { id, position: 'before' }
  if (offset > 1 - EDGE) return { id, position: 'after' }
  return { id, position: container ? 'into' : offset < 0.5 ? 'before' : 'after' }
}

/**
 * Dragging rows in the layers panel.
 *
 * Pointer events rather than HTML drag and drop, because the latter cannot be styled, fires
 * no move events on some platforms, and needs an image it would never look right with.
 */
export function useLayerDrag(): LayerDrag {
  const [dragging, setDragging] = useState<NodeId | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const pending = useRef<{ id: NodeId; x: number; y: number } | null>(null)

  const start = useCallback((id: NodeId, event: React.PointerEvent) => {
    if (event.button !== 0) return
    // A generated row is not the user's to move; the order it sits in is the code's output.
    if (scene.getNode(id)?.sourceKey !== undefined) return
    pending.current = { id, x: event.clientX, y: event.clientY }

    const onMove = (move: PointerEvent): void => {
      const from = pending.current
      if (!from) return
      // Nothing happens until the pointer has actually travelled, so a click that selects a
      // layer never flickers a drop indicator on its way.
      if (Math.abs(move.clientX - from.x) + Math.abs(move.clientY - from.y) < THRESHOLD) return
      setDragging(from.id)
      setTarget(targetUnder(move.clientX, move.clientY, from.id))
    }

    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)

      const from = pending.current
      pending.current = null
      setDragging(null)
      setTarget(null)
      if (!from) return

      const drop = targetUnder(up.clientX, up.clientY, from.id)
      if (!drop) return
      applyDrop(from.id, drop)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  return { dragging, target, start }
}

function applyDrop(id: NodeId, drop: DropTarget): void {
  // The parent left behind closes its flow in the same step as the move that emptied it.
  const oldParent = scene.getNode(id)?.parent

  if (drop.position === 'into') {
    scene.transact(() => {
      scene.reparent(id, drop.id)
      relayout(scene, oldParent ? [id, oldParent] : [id])
    })
    // A collapsed frame still accepts a drop, but the moved row would vanish into the
    // closed subtree. Opening the target keeps the result of the drop on screen.
    useUI.getState().setCollapsed(drop.id, false)
    return
  }

  const sibling = scene.getNode(drop.id)
  if (!sibling?.parent) return
  const siblingParent = sibling.parent

  // The panel lists children back to front reversed, so "before" on screen is a higher index.
  const base = scene.indexOf(drop.id)
  const index = drop.position === 'before' ? base + 1 : base

  if (siblingParent === scene.getNode(id)?.parent) {
    // Same parent, so this is only a reshuffle. Removing the node first would shift the
    // index, which is why reorder takes a final position rather than a delta.
    const from = scene.indexOf(id)
    scene.transact(() => {
      scene.reorder(id, from < index ? index - 1 : index)
      relayout(scene, [id])
    })
    return
  }
  scene.transact(() => {
    scene.reparent(id, siblingParent, index)
    relayout(scene, oldParent ? [id, oldParent] : [id])
  })
}
