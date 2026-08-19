import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react'
import type { NodeId } from '@figma-canvas/document'
import { updateText } from '../state/font'
import { closeBurst, endEditing, openBurst } from '../state/textEditing'
import { useNode } from '../state/scene'
import { useUI } from '../state/uiStore'
import styles from './TextEditor.module.css'

/** Roughly the system rate. Slower reads as sluggish, faster as jittery. */
const BLINK_INTERVAL = 530

/**
 * Everything about typing that has to be DOM, and nothing else.
 *
 * The textarea is invisible but focused, and it is the only reason this component exists: it
 * is what makes dead keys, autocorrect and an IME candidate window work, none of which can be
 * reimplemented on top of raw keydown events. What it is emphatically not is what you see.
 * The glyphs are drawn by the renderer from the document, and the caret and the selection
 * highlight are drawn by the overlay, so the text is never on screen twice and there is
 * nothing that can disagree or jitter.
 *
 * Opacity zero rather than display none or visibility hidden, both of which stop an element
 * receiving composition events at all.
 */
export function TextEditor(): ReactElement | null {
  const editing = useUI((state) => state.editing)
  const node = useNode(editing?.id)
  const ref = useRef<HTMLTextAreaElement>(null)
  /*
   * The last caret this component put into the field, so it can tell a caret the store moved
   * from one the field moved itself. Read by the sync below. See the comment there.
   *
   * Keyed by node, because the field is remounted when editing moves to another one and an
   * offset that matched the node just left says nothing about the one just opened.
   */
  const applied = useRef<{ id: NodeId; caret: number; anchor: number } | null>(null)

  const editingId = editing?.id
  const caret = editing?.caret ?? 0
  const anchor = editing?.anchor ?? 0
  /*
   * Null, not the empty string, when there is no text node to read. The effect below writes
   * this into the field, and an empty string written there is one keystroke away from being
   * committed back as the node's new contents. A node that is briefly not there must leave
   * the field alone rather than blank it.
   */
  const characters = node?.type === 'text' ? node.characters : null

  // Focus once per node, not on every render: refocusing mid composition drops the half
  // typed characters the IME is still holding.
  useEffect(() => {
    if (!editingId) return
    ref.current?.focus({ preventScroll: true })
  }, [editingId])

  /*
   * The document is the source of truth for the text, so the field is pushed back into line
   * whenever they differ. That is what makes undo work while the editor is open: the history
   * step restores the document, and the field follows rather than overwriting it back.
   *
   * A layout effect, not an ordinary one, because the field is uncontrolled and therefore
   * starts empty. Anything that reached it before this ran would report an empty value and
   * blank the node. Controlled would close that window too, but a controlled field fights an
   * IME over the half composed characters it is still holding, which is the whole reason
   * this component exists.
   *
   * The text and the caret are pushed back on different terms, and the difference is load
   * bearing. A keystroke reaches this synchronously, because typing is a discrete event and
   * React flushes it without waiting, while `selectionchange` is queued and arrives after. So
   * at this point the store's caret is still where it was before the character was typed, and
   * writing it back would drag the caret to the front of the field and leave it there: every
   * further keystroke lands at offset zero, and "abc" is typed as "cba". The caret is
   * therefore written only when it moved for a reason outside the field, which is an undo, a
   * click that placed it, or the value having just been replaced under it.
   */
  useLayoutEffect(() => {
    const field = ref.current
    if (!field || characters === null || !editingId) return

    const replaced = field.value !== characters
    if (replaced) field.value = characters

    const last = applied.current
    const moved = last?.id !== editingId || last.caret !== caret || last.anchor !== anchor
    if (!replaced && !moved) return

    applied.current = { id: editingId, caret, anchor }
    const from = Math.min(anchor, caret)
    const to = Math.max(anchor, caret)
    if (field.selectionStart !== from || field.selectionEnd !== to) {
      field.setSelectionRange(from, to, anchor > caret ? 'backward' : 'forward')
    }
  }, [editingId, characters, caret, anchor])

  /*
   * selectionchange on the document, not React's onSelect. React polyfills onSelect from a
   * narrow set of events and it does not fire for a caret moved by the keyboard, which is
   * most of how a caret moves. This one fires for the keyboard, the mouse and a programmatic
   * change alike.
   */
  useEffect(() => {
    if (!editingId) return
    const onSelectionChange = (): void => {
      const field = ref.current
      if (!field || window.document.activeElement !== field) return
      // The end that moves is the one the caret is drawn at, which is what makes shift and
      // an arrow key grow the selection from the end being dragged rather than always right.
      const backwards = field.selectionDirection === 'backward'
      const caretAt = backwards ? field.selectionStart : field.selectionEnd
      const anchorAt = backwards ? field.selectionEnd : field.selectionStart
      useUI.getState().setTextCaret(caretAt, anchorAt)
    }
    window.document.addEventListener('selectionchange', onSelectionChange)
    return () => window.document.removeEventListener('selectionchange', onSelectionChange)
  }, [editingId])

  // A caret that blinks would otherwise need the render loop to run forever. It runs only
  // while something is being edited, and stops the moment it is not.
  useEffect(() => {
    if (!editingId) return
    const timer = window.setInterval(() => {
      const state = useUI.getState()
      if (state.editing) state.setCaretVisible(!state.editing.caretVisible)
    }, BLINK_INTERVAL)
    return () => window.clearInterval(timer)
  }, [editingId])

  const commit = (field: HTMLTextAreaElement): void => {
    if (node?.type !== 'text') return
    openBurst()
    updateText(node, { characters: field.value })
  }

  if (!editing || node?.type !== 'text') return null

  return (
    <textarea
      ref={ref}
      className={styles.field}
      aria-label="Text content"
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => commit(event.currentTarget)}
      onBlur={closeBurst}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          endEditing()
        }
        /*
         * Nothing typed in here may reach the canvas. Backspace would delete the node,
         * Cmd+A would select every layer, and a plain letter would switch tools. React
         * attaches at the root container, so this runs before either window listener and
         * stopping it here stops the native event too.
         */
        event.stopPropagation()
      }}
    />
  )
}
