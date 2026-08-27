import { create } from 'zustand'
import type { AgentQuestion, QuestionAnswer } from '@canvas/agent-server/protocol'

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
export type AgentStatus =
  | 'offline'
  | 'connecting'
  | 'idle'
  | 'busy'
  | 'stopping'
  /**
   * Open in another tab, which now holds the one editor the server keeps. The only state
   * here that is not a wait: nothing is coming, and it ends when the person asks for the
   * assistant back rather than when the network changes its mind.
   */
  | 'displaced'

/**
 * The two questions the union is actually asked, beside the union itself, the way
 * `clipsChildren` sits beside the node kinds it answers for.
 *
 * Every affordance the assistant has wants one of these rather than the status itself: the
 * composer and the send button want `isConnected`, the stop button, the status dot, the
 * live steps chip and the tool bar's assistant button want `isWorking`. Spelled out at the call site
 * they are a disjunction to keep in step across two files, and this union has already grown
 * twice, from three values to six.
 */
export function isWorking(status: AgentStatus): boolean {
  return status === 'busy' || status === 'stopping'
}

export function isConnected(status: AgentStatus): boolean {
  return status === 'idle' || isWorking(status)
}

export interface ChatItem {
  id: number
  /**
   * `tool-error` is a step that failed, and it is deliberately not `error`: it folds with
   * the run of steps it belongs to, because a tool the model will retry is process rather
   * than an answer. `notice` is the panel talking about itself, a stop or a lost connection,
   * which is neither the person's words nor the model's. `question` is the assistant asking
   * the person something and waiting on the answer, an interactive card while it is pending
   * and a record of the choice once it is not.
   */
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'tool-error' | 'error' | 'notice' | 'question'
  /**
   * The message, or for a `question` the question itself, so every existing reader that shows
   * `text` still shows something sensible and the extra structure below is additive.
   */
  text: string
  /**
   * On a `question` item only. `askId` is the server's id for the question, echoed back in the
   * answer; `question` is what to render; `answer` is the person's choice once they have made
   * it, absent while the card is still open.
   */
  askId?: number
  question?: AgentQuestion
  answer?: QuestionAnswer
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
  /**
   * The server id of the question awaiting an answer right now, or null. Held in memory only,
   * never restored from storage: a question read back from a past session has no live turn to
   * answer to, so it renders as a record rather than an interactive card. At most one is ever
   * pending, since the model's turn blocks on it.
   */
  pendingAsk: number | null
  setStatus: (status: AgentStatus) => void
  setDraft: (draft: string) => void
  setOpen: (open: boolean) => void
  setNextAttemptAt: (at: number | null) => void
  append: (kind: ChatItem['kind'], text: string) => void
  /** Append a question card and mark it the one awaiting an answer. */
  ask: (askId: number, question: AgentQuestion) => void
  /** Record the person's answer on its card and, if it was the pending one, clear that. */
  answerQuestion: (askId: number, answer: QuestionAnswer) => void
  /**
   * Stop waiting on the pending question without answering it, leaving its card as an
   * unanswered record. For when the turn ends or the connection drops out from under it.
   */
  clearPendingAsk: () => void
  /**
   * Replaces the transcript with a restored one, pushing the id generator past every id it
   * holds. Without that a restored id and a fresh one collide, and two rows in the list end
   * up sharing a key. The same rule `document.load` follows for node ids.
   */
  load: (items: readonly ChatItem[]) => void
  clear: () => void
  /** Bumped by anything that wants the composer focused. The panel focuses on each change. */
  focusToken: number
  /** Open the card and put the caret in it, whether or not it was already open. */
  openForInput: () => void
}

let nextItemId = 1

export const useAgent = create<AgentState>()((set) => ({
  status: 'offline',
  open: false,
  items: [],
  draft: '',
  nextAttemptAt: null,
  pendingAsk: null,
  focusToken: 0,
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
  ask: (askId, question) =>
    set((state) => {
      nextItemId += 1
      const item: ChatItem = { id: nextItemId, kind: 'question', text: question.question, askId, question }
      return { items: [...state.items, item], pendingAsk: askId }
    }),
  answerQuestion: (askId, answer) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.kind === 'question' && item.askId === askId ? { ...item, answer } : item,
      ),
      pendingAsk: state.pendingAsk === askId ? null : state.pendingAsk,
    })),
  clearPendingAsk: () => set((state) => (state.pendingAsk === null ? state : { pendingAsk: null })),
  load: (items) =>
    set(() => {
      for (const item of items) nextItemId = Math.max(nextItemId, item.id)
      return { items: [...items] }
    }),
  clear: () => set({ items: [] }),
  // A token rather than a flag, because the same shortcut pressed twice has to focus twice
  // and `open` will not have changed the second time.
  openForInput: () => set((state) => ({ open: true, focusToken: state.focusToken + 1 })),
}))
