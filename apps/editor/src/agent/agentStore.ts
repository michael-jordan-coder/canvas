import { create } from 'zustand'

/**
 * Chat state for the agent panel. View state in exactly the sense the UI store is: none of
 * it is part of the document, and the transcript belongs to this tab, not to the file.
 */

export type AgentStatus = 'offline' | 'idle' | 'busy'

export interface ChatItem {
  id: number
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'error'
  text: string
  /** Data URLs, for the thumbnails on a user message. Only ever set on kind 'user'. */
  images?: string[]
}

interface AgentState {
  status: AgentStatus
  open: boolean
  items: ChatItem[]
  setStatus: (status: AgentStatus) => void
  setOpen: (open: boolean) => void
  append: (kind: ChatItem['kind'], text: string, images?: string[]) => void
  clear: () => void
}

let nextItemId = 1

export const useAgent = create<AgentState>()((set) => ({
  status: 'offline',
  open: false,
  items: [],
  setStatus: (status) => set({ status }),
  setOpen: (open) => set({ open }),
  append: (kind, text, images) =>
    set((state) => {
      nextItemId += 1
      return { items: [...state.items, { id: nextItemId, kind, text, ...(images ? { images } : {}) }] }
    }),
  clear: () => set({ items: [] }),
}))
