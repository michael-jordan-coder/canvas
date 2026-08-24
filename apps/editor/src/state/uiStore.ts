import { create } from 'zustand'
import type { NodeId } from '@canvas/document'
import type { TextEditing } from '@canvas/renderer'
import type { SelectionContext } from './selectionTarget'

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
   * The container clicks resolve inside, or null for the page. Set by whatever stepped in,
   * read by the next click, and view state in the purest sense: how deep someone is working
   * is theirs, not the file's. `selectionTarget` owns what it means.
   */
  context: SelectionContext
  /**
   * The text node being typed into, or null. Emphatically not part of the document: where
   * someone's caret is, is theirs, the same way their selection and their tool are.
   */
  editing: TextEditing | null
  setTool: (tool: ToolId) => void
  setSelection: (ids: readonly NodeId[]) => void
  setContext: (context: SelectionContext) => void
  toggleInSelection: (id: NodeId) => void
  clearSelection: () => void
  setCollapsed: (id: NodeId, collapsed: boolean) => void
  collapseAll: (ids: Iterable<NodeId>) => void
  beginTextEdit: (id: NodeId, caret: number, anchor?: number) => void
  setTextCaret: (caret: number, anchor: number) => void
  setCaretVisible: (caretVisible: boolean) => void
  endTextEdit: () => void
}

export const useUI = create<UIState>()((set) => ({
  tool: 'move',
  selection: [],
  collapsed: new Set<NodeId>(),
  context: null,
  editing: null,
  // Only the tool. Ending an editing session has rules that live in `state/textEditing.ts`,
  // and clearing the field here would skip them: `selectTool` there is the way in.
  setTool: (tool) => set({ tool }),
  setSelection: (ids) => set({ selection: ids }),
  setContext: (context) => set((state) => (state.context === context ? state : { context })),
  toggleInSelection: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((other) => other !== id)
        : [...state.selection, id],
    })),
  // Also steps back out to the page. Clearing the selection is how someone says they are done
  // with what they were in, and a context left behind would silently keep the next click deep.
  clearSelection: () => set({ selection: [], context: null }),
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
  /*
   * The ids come from the caller because the store has no document to walk. It holds which
   * rows are folded and nothing about what a row is, which is what keeps it view state
   * rather than a second, lagging copy of the tree.
   */
  collapseAll: (ids) => set({ collapsed: new Set(ids) }),
  setCollapsed: (id, collapsed) =>
    set((state) => {
      if (state.collapsed.has(id) === collapsed) return state
      const next = new Set(state.collapsed)
      if (collapsed) next.add(id)
      else next.delete(id)
      return { collapsed: next }
    }),
}))
