import type { NodeId, SceneDocument } from '@figma-canvas/document'
import { reorderSelection } from '../state/order'

export interface KeyboardInputOptions {
  document: SceneDocument
  getSelection: () => readonly NodeId[]
  setSelection: (ids: readonly NodeId[]) => void
}

/** A shortcut must not fire while someone is typing a value into the properties panel. */
function isEditingText(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLElement && target.isContentEditable
}

export function createKeyboardInput(options: KeyboardInputOptions): () => void {
  const { document: scene } = options

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

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (event.repeat) return
      deleteSelection()
    }
  }

  window.addEventListener('keydown', onKeyDown)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
  }
}
