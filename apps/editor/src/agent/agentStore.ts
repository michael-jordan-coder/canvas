import { create } from 'zustand'

/**
 * Chat state for the agent panel. View state in exactly the sense the UI store is: none of
 * it is part of the document, and the transcript belongs to this tab, not to the file.
 */

/**
 * Where the assistant stands, as one value, because every affordance in the panel reads it:
 * the composer, the send and stop buttons, the status dot and the connection strip.
 *
 * `connecting` and `stopping` exist because both are a wait the person started, and a wait
 * with no name looks like nothing happening. `stopping` in particular covers the gap
 * between the stop reaching the server and the turn actually ending, which is however long
 * the model takes to notice.
 */
export type AgentStatus = 'offline' | 'connecting' | 'idle' | 'busy' | 'stopping'

export interface ChatItem {
  id: number
  /**
   * `tool-error` is a step that failed, and it is deliberately not `error`: it folds with
   * the run of steps it belongs to, because a tool the model will retry is process rather
   * than an answer. `notice` is the panel talking about itself, a stop or a lost connection,
   * which is neither the person's words nor the model's.
   */
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'tool-error' | 'error' | 'notice'
  text: string
}

interface AgentState {
  status: AgentStatus
  open: boolean
  items: ChatItem[]
  /**
   * What is typed and not yet sent. In the store rather than in the panel because the panel
   * unmounts when the card closes, and because a message the server refuses is handed back
   * here to be typed again rather than lost.
   */
  draft: string
  /**
   * When the next automatic reconnect is due, as a timestamp, or null when none is pending.
   * The panel counts down from it rather than owning the schedule, which stays in
   * `connection.ts` beside the socket it is about.
   */
  nextAttemptAt: number | null
  setStatus: (status: AgentStatus) => void
  setDraft: (draft: string) => void
  setOpen: (open: boolean) => void
  setNextAttemptAt: (at: number | null) => void
  append: (kind: ChatItem['kind'], text: string) => void
  clear: () => void
}

let nextItemId = 1

export const useAgent = create<AgentState>()((set) => ({
  status: 'offline',
  open: false,
  items: [],
  draft: '',
  nextAttemptAt: null,
  setStatus: (status) => set((state) => (state.status === status ? state : { status })),
  setDraft: (draft) => set((state) => (state.draft === draft ? state : { draft })),
  setOpen: (open) => set((state) => (state.open === open ? state : { open })),
  setNextAttemptAt: (nextAttemptAt) =>
    set((state) => (state.nextAttemptAt === nextAttemptAt ? state : { nextAttemptAt })),
  append: (kind, text) =>
    set((state) => {
      nextItemId += 1
      return { items: [...state.items, { id: nextItemId, kind, text }] }
    }),
  clear: () => set({ items: [] }),
}))
