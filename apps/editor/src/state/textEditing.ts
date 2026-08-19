import type { NodeId } from '@figma-canvas/document'
import { scene } from './scene'
import { useUI, type ToolId } from './uiStore'

/**
 * The rules of an inline editing session: what a typing burst is, and how a session ends.
 *
 * Here rather than in `TextEditor.tsx` because the input layer and the canvas host both need
 * to end a session, and neither should be importing from a UI component to do it. What is
 * left in the component is the textarea and the DOM effects that drive it, which is what its
 * docstring claims it is.
 *
 * The state is module level and mutable on purpose. `TextEditor` returns null when nothing is
 * being edited rather than unmounting, so an effect cleanup would never run, and a burst left
 * open silently folds every later edit in the session into a step that never commits.
 */

/**
 * How long typing has to stop before the burst becomes its own undo step.
 *
 * The same 600ms the autosave uses, and for the same reason: long enough that a sentence is
 * one step, short enough that a pause reads as finishing a thought. Undo per keystroke would
 * empty the 200 step history in two words.
 */
const TYPING_IDLE = 600

let burstOpen = false
let burstTimer: number | undefined

export function closeBurst(): void {
  window.clearTimeout(burstTimer)
  if (!burstOpen) return
  burstOpen = false
  scene.endHistoryGroup()
}

/** Opens the burst if it is not already, and restarts the clock that closes it. */
export function openBurst(): void {
  if (!burstOpen) {
    burstOpen = true
    scene.beginHistoryGroup()
  }
  window.clearTimeout(burstTimer)
  burstTimer = window.setTimeout(closeBurst, TYPING_IDLE)
}

// Focus can be lost without anything else arriving to close the burst: alt tab, a system
// dialog, the tab going away. The same safety net the arrow key nudge uses.
window.addEventListener('blur', closeBurst)

/** Opens a session on a text node, placing the caret at an offset. */
export function beginEditing(id: NodeId, caret: number, anchor?: number): void {
  useUI.getState().beginTextEdit(id, caret, anchor)
}

/**
 * Ends the session, discarding a node that never gained a character.
 *
 * The same guard the shape tools use for a zero sized drag: a click that turns out to be a
 * click leaves nothing behind. Removal and the selection change go in one transaction, so the
 * step records the emptied selection as its own and redo does not restore a stale one.
 *
 * This is the only way out of a session. Anything that clears `editing` without coming
 * through here leaves the burst open and the empty node behind.
 */
export function endEditing(): void {
  const ui = useUI.getState()
  const editing = ui.editing
  if (!editing) return

  // Before anything else. Leaving the burst open would swallow the removal below, and every
  // edit after it, into a step that never commits.
  closeBurst()

  const node = scene.getNode(editing.id)
  ui.endTextEdit()

  if (node?.type === 'text' && node.characters.length === 0) {
    scene.transact(() => {
      scene.remove(node.id)
      ui.setSelection([])
    })
  }
}

/**
 * Picks a tool, ending any session first.
 *
 * Reaching for another tool is a way of saying the current gesture is over, so it has to go
 * through the same exit a click away does. The store's `setTool` only sets the tool: it
 * cannot call this without the state layer depending on itself.
 */
export function selectTool(tool: ToolId): void {
  endEditing()
  useUI.getState().setTool(tool)
}
