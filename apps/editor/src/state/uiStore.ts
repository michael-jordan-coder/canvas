import { create } from 'zustand'
import type { NodeId } from '@figma-canvas/document'
import type { TextEditing } from '@figma-canvas/renderer'

export type ToolId = 'move' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text'

/**
 * Design mode edits the document; preview mode runs it.
 *
 * The difference is entirely about who gets the pointer. In design mode every event belongs
 * to the canvas, which hit tests, selects and drags, and the mounted components are inert.
 * In preview mode the components take their own events back and behave exactly as they would
 * in a real application, while the canvas keeps only panning and zooming.
 *
 * View state, like the tool and the selection: two people with the same file open can be in
 * different modes, and neither of them has changed the document by choosing one.
 */
export type EditorMode = 'design' | 'preview'

/**
 * View state only. Nothing here is part of the file: two people opening the same document
 * have their own tool, their own selection and their own panel widths.
 */
interface UIState {
  tool: ToolId
  mode: EditorMode
  selection: readonly NodeId[]
  /** Layer rows folded shut in the panel. Session only, never persisted with the file. */
  collapsed: ReadonlySet<NodeId>
  /**
   * The text node being typed into, or null. Emphatically not part of the document: where
   * someone's caret is, is theirs, the same way their selection and their tool are.
   */
  editing: TextEditing | null
  setTool: (tool: ToolId) => void
  setMode: (mode: EditorMode) => void
  setSelection: (ids: readonly NodeId[]) => void
  toggleInSelection: (id: NodeId) => void
  clearSelection: () => void
  setCollapsed: (id: NodeId, collapsed: boolean) => void
  beginTextEdit: (id: NodeId, caret: number, anchor?: number) => void
  setTextCaret: (caret: number, anchor: number) => void
  setCaretVisible: (caretVisible: boolean) => void
  endTextEdit: () => void
}

export const useUI = create<UIState>()((set) => ({
  tool: 'move',
  mode: 'design',
  selection: [],
  collapsed: new Set<NodeId>(),
  editing: null,
  // Only the tool. Ending an editing session has rules that live in `state/textEditing.ts`,
  // and clearing the field here would skip them: `selectTool` there is the way in.
  setTool: (tool) => set({ tool }),
  /*
   * Preview always starts from the move tool. A shape tool left armed would draw a rectangle
   * the moment preview mode handed a click back to the canvas, and the editing session is
   * ended by the caller in `textEditing.ts` for the same reason a tool change ends one.
   */
  setMode: (mode) => set((state) => (state.mode === mode ? state : { mode, tool: 'move' })),
  setSelection: (ids) => set({ selection: ids }),
  toggleInSelection: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((other) => other !== id)
        : [...state.selection, id],
    })),
  clearSelection: () => set({ selection: [] }),
  beginTextEdit: (id, caret, anchor = caret) =>
    set({ editing: { id, caret, anchor, caretVisible: true }, selection: [id] }),
  setTextCaret: (caret, anchor) =>
    set((state) => {
      if (!state.editing) return state
      if (state.editing.caret === caret && state.editing.anchor === anchor) return state
      // Visible again on every move: a caret that blinks out mid keystroke reads as lag.
      return { editing: { ...state.editing, caret, anchor, caretVisible: true } }
    }),
  setCaretVisible: (caretVisible) =>
    set((state) => {
      if (!state.editing || state.editing.caretVisible === caretVisible) return state
      return { editing: { ...state.editing, caretVisible } }
    }),
  endTextEdit: () => set((state) => (state.editing ? { editing: null } : state)),
  setCollapsed: (id, collapsed) =>
    set((state) => {
      if (state.collapsed.has(id) === collapsed) return state
      const next = new Set(state.collapsed)
      if (collapsed) next.add(id)
      else next.delete(id)
      return { collapsed: next }
    }),
}))
