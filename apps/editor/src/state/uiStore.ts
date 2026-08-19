import { create } from 'zustand'
import type { NodeId } from '@figma-canvas/document'

export type ToolId = 'move' | 'hand' | 'frame' | 'rectangle' | 'ellipse'

/**
 * View state only. Nothing here is part of the file: two people opening the same document
 * have their own tool, their own selection and their own panel widths.
 */
interface UIState {
  tool: ToolId
  selection: readonly NodeId[]
  /** Layer rows folded shut in the panel. Session only, never persisted with the file. */
  collapsed: ReadonlySet<NodeId>
  setTool: (tool: ToolId) => void
  setSelection: (ids: readonly NodeId[]) => void
  toggleInSelection: (id: NodeId) => void
  clearSelection: () => void
  setCollapsed: (id: NodeId, collapsed: boolean) => void
}

export const useUI = create<UIState>()((set) => ({
  tool: 'move',
  selection: [],
  collapsed: new Set<NodeId>(),
  setTool: (tool) => set({ tool }),
  setSelection: (ids) => set({ selection: ids }),
  toggleInSelection: (id) =>
    set((state) => ({
      selection: state.selection.includes(id)
        ? state.selection.filter((other) => other !== id)
        : [...state.selection, id],
    })),
  clearSelection: () => set({ selection: [] }),
  setCollapsed: (id, collapsed) =>
    set((state) => {
      if (state.collapsed.has(id) === collapsed) return state
      const next = new Set(state.collapsed)
      if (collapsed) next.add(id)
      else next.delete(id)
      return { collapsed: next }
    }),
}))
