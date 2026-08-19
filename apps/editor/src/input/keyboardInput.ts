import { applyToVector, IDENTITY, invert, type NodeId, type SceneDocument, type Vec2 } from '@figma-canvas/document'
import { reorderSelection } from '../state/order'
import { isEditingText } from './isEditingText'

export interface KeyboardInputOptions {
  document: SceneDocument
  getSelection: () => readonly NodeId[]
  setSelection: (ids: readonly NodeId[]) => void
}

const NUDGE_STEP = 1
const NUDGE_STEP_LARGE = 10

const ARROW_DELTAS: Record<string, Vec2> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
}

export function createKeyboardInput(options: KeyboardInputOptions): () => void {
  const { document: scene } = options

  // Keys of the nudge burst currently held. A whole burst, however many arrow keys and however
  // many repeats it produces, is one history group: opened on the first keydown, closed once the
  // last of them is released. A held key repeats around 30 times a second, so recording one step
  // per repeat would burn through the 200 step cap in a few seconds of holding a key down.
  const heldNudgeKeys = new Set<string>()

  const deleteSelection = (): void => {
    const selection = options.getSelection()
    if (selection.length === 0) return
    // One transaction, so this is one undo step, and so the cleared selection is what the
    // step records as its "after". Undoing brings the nodes back and reselects them.
    scene.transact(() => {
      for (const id of selection) scene.remove(id)
      options.setSelection([])
    })
  }

  const selectAll = (): void => {
    const ids = scene
      .getChildren(scene.rootId)
      .filter((node) => node.visible && !node.locked)
      .map((node) => node.id)
    options.setSelection(ids)
  }

  const nudgeSelection = (direction: Vec2, step: number): void => {
    const selection = options.getSelection()
    if (selection.length === 0) return
    const worldDelta = { x: direction.x * step, y: direction.y * step }
    scene.transact(() => {
      for (const id of selection) {
        const node = scene.getNode(id)
        if (!node || node.locked) continue
        const parentWorld = node.parent ? scene.worldTransform(node.parent) : IDENTITY
        const local = applyToVector(invert(parentWorld), worldDelta)
        scene.update(id, {
          transform: { ...node.transform, tx: node.transform.tx + local.x, ty: node.transform.ty + local.y },
        })
      }
    })
  }

  // If focus is lost mid-hold (alt-tab, a system dialog stealing the key), no keyup ever
  // arrives to close the group. Left open, it would silently fold every later edit into this
  // one step until something else happens to close it, so force it shut on blur.
  const onWindowBlur = (): void => {
    if (heldNudgeKeys.size === 0) return
    heldNudgeKeys.clear()
    scene.endHistoryGroup()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditingText(event.target)) return

    const accel = event.metaKey || event.ctrlKey

    if (accel && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      // Held keys repeat around 30 times a second, which would empty a 200 step history in
      // about seven. One press, one step. Flip this if holding to rewind is wanted instead.
      if (event.repeat) return
      if (event.shiftKey) scene.redo()
      else scene.undo()
      return
    }

    // The Windows convention for redo, harmless to support everywhere.
    if (accel && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      if (event.repeat) return
      scene.redo()
      return
    }

    // Cmd+] and Cmd+[ step one place, adding alt jumps all the way, matching Figma.
    if (accel && (event.key === ']' || event.key === '[')) {
      event.preventDefault()
      if (event.repeat) return
      const forward = event.key === ']'
      reorderSelection(
        scene,
        options.getSelection(),
        event.altKey ? (forward ? 'front' : 'back') : forward ? 'forward' : 'backward',
      )
      return
    }

    if (accel && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      if (event.repeat) return
      selectAll()
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (event.repeat) return
      deleteSelection()
      return
    }

    if (event.key === 'Escape') {
      if (options.getSelection().length === 0) return
      event.preventDefault()
      options.setSelection([])
      return
    }

    const direction = ARROW_DELTAS[event.key]
    if (direction) {
      if (options.getSelection().length === 0) return
      event.preventDefault()
      if (!heldNudgeKeys.has(event.key)) {
        heldNudgeKeys.add(event.key)
        if (heldNudgeKeys.size === 1) scene.beginHistoryGroup()
      }
      nudgeSelection(direction, event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP)
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!(event.key in ARROW_DELTAS)) return
    if (!heldNudgeKeys.delete(event.key)) return
    if (heldNudgeKeys.size === 0) scene.endHistoryGroup()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onWindowBlur)
  }
}
