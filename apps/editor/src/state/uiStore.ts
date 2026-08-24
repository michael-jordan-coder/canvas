import { create } from 'zustand'
import type { NodeId } from '@canvas/document'
import type { TextEditing } from '@canvas/renderer'

export type ToolId = 'move' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text'

/**
 * View state only. Nothing here is part of the file: two people opening the same document
 * have their own tool, their own selection and their own panel widths.
 */
interface UIState {
  tool: ToolId
  selection: readonly NodeId[]
  /** Layer rows folded shut in the panel. Session only, never persisted with the file. */
  collapsed: ReadonlySet<NodeId>
  /**
   * The text node being typed into, or null. Emphatically not part of the document: where
   * someone's caret is, is theirs, the same way their selection and their tool are.
   */
  editing: TextEditing | null
  setTool: (tool: ToolId) => void
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
  selection: [],
  collapsed: new Set<NodeId>(),
  editing: null,
  // Only the tool. Ending an editing session has rules that live in `state/textEditing.ts`,
  // and clearing the field here would skip them: `selectTool` there is the way in.
  setTool: (tool) => set({ tool }),
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
