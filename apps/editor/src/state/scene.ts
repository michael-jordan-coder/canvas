import { useCallback, useSyncExternalStore } from 'react'
import {
  SceneDocument,
  createEllipse,
  createFrame,
  createRectangle,
  createText,
  fromHex,
  translation,
  type NodeId,
  type SceneNode,
} from '@figma-canvas/document'
import { relayoutAll } from './autoLayout'
import { useUI } from './uiStore'
import { readSaved, startAutosave } from './persistence'
import { seedStressScene, stressCountFromLocation } from './stress'

/**
 * One document for the running editor. The renderer will read this directly every frame;
 * React only ever reads it through the hooks below.
 */
export const scene = new SceneDocument()

/**
 * Selection rides along with each undo step. The document holds it as an opaque value and
 * never learns what it is, which keeps selection out of the file where it belongs.
 */
scene.setSideState<readonly NodeId[]>({
  capture: () => useUI.getState().selection,
  restore: (ids) => useUI.getState().setSelection(ids),
})

/*
 * A revision per node, so a panel showing one node wakes only when that node changes.
 * Without this, dragging a rectangle would re-render every row in the layers tree.
 */
const revisions = new Map<NodeId, number>()
let structureRevision = 0

scene.subscribe((change) => {
  for (const id of change.changed) revisions.set(id, (revisions.get(id) ?? 0) + 1)
  if (change.structural) structureRevision += 1
})

function revisionOf(id: NodeId): number {
  return revisions.get(id) ?? 0
}

export function useNode(id: NodeId | undefined): SceneNode | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!id) return () => {}
      return scene.subscribe((change) => {
        if (change.changed.has(id)) onChange()
      })
    },
    [id],
  )
  const snapshot = useCallback(() => (id ? revisionOf(id) : -1), [id])
  useSyncExternalStore(subscribe, snapshot)
  return id ? scene.getNode(id) : undefined
}

function subscribeToStructure(onChange: () => void): () => void {
  return scene.subscribe((change) => {
    if (change.structural) onChange()
  })
}

/** Structure only. Each row subscribes to its own node for name and visibility. */
export function useChildren(id: NodeId): SceneNode[] {
  useSyncExternalStore(subscribeToStructure, () => structureRevision)
  return scene.getChildren(id)
}

function seed(): void {
  scene.transact(() => {
    const frame = scene.insert(
      createFrame({
        name: 'Frame 1',
        transform: translation(-160, -120),
        size: { width: 320, height: 240 },
        fills: [fromHex('#ffffff')],
      }),
    )
    scene.insert(
      createRectangle({
        name: 'Rectangle',
        transform: translation(24, 24),
        size: { width: 140, height: 90 },
        fills: [fromHex('#0a7cff')],
        cornerRadius: 4,
      }),
      frame.id,
    )
    scene.insert(
      createText({
        name: 'Text',
        transform: translation(24, 150),
        characters: 'Hamburgefonstiv',
        fontSize: 18,
        fills: [fromHex('#1a1a1a')],
      }),
      frame.id,
    )
    scene.insert(
      createEllipse({
        name: 'Ellipse',
        transform: translation(170, 130),
        size: { width: 90, height: 90 },
        fills: [fromHex('#1a1a1a')],
      }),
      frame.id,
    )
  })
}

const stressCount = stressCountFromLocation()
if (stressCount > 0) {
  seedStressScene(scene, stressCount)
} else {
  const saved = readSaved()
  if (saved) scene.load(saved.root, saved.nodes)
  else seed()
  // Defensive: a file this build saved is already settled and this writes nothing, but a
  // file whose layout drifted (an older build, a hand edit) straightens out on open.
  relayoutAll(scene)
}
// Neither the seed, a load, nor the normalising layout is an edit, so none must be undoable.
scene.clearHistory()

// Autosave is off in stress mode. Persisting ten thousand throwaway nodes would then load
// them again on the next ordinary visit.
if (stressCount === 0) startAutosave(scene)
