import type {
  AgentQuestion,
  AgentQuestionOption,
  QuestionAnswer,
} from '@canvas/agent-server/protocol'
import { readStored, startDebouncedSave, writeStored } from '../state/localStorage'
import { useAgent, type ChatItem } from './agentStore'

/**
 * The transcript, across a reload.
 *
 * It is worth keeping for a reason beyond convenience: the server holds the conversation as
 * an SDK session that survives the tab, so without this the model remembers a conversation
 * the person can no longer see. What is stored is what was said, never the status, the
 * draft or which tab the panel is on, all of which are about this moment rather than about
 * the conversation.
 *
 * Storage conventions are `state/persistence.ts`'s: the `figma-canvas:` prefix, a version in
 * the envelope, a 600ms debounce with a `pagehide` flush, and every access in a try/catch,
 * since Safari private mode throws on access rather than failing. The one deliberate
 * difference is that an unreadable value is dropped rather than quarantined. A document is
 * someone's work and starting blank looks exactly like losing it; a chat is a record of
 * something that already happened, and a key nobody will ever open is clutter.
 */

const KEY = 'figma-canvas:agent-chat'
const VERSION = 1
/** The same cap the undo stack takes, for the same reason: the recent end is the live part. */
const MAX_ITEMS = 200
/** One thinking block can be tens of kilobytes, and the document needs the quota more. */
const MAX_BYTES = 64 * 1024
const SAVE_DELAY = 600

const KINDS: ReadonlySet<string> = new Set([
  'user',
  'assistant',
  'thinking',
  'tool',
  'tool-error',
  'error',
  'notice',
  'question',
])

/**
 * A question restored from storage, validated by hand like everything else that left the
 * process. It comes back as a record, never as a live card: the server ids it was answered
 * against are gone, so `askId` is deliberately not restored. A malformed question drops the
 * whole item rather than rendering half a card.
 */
function parseQuestion(value: unknown): AgentQuestion | null {
  if (typeof value !== 'object' || value === null) return null
  const q = value as { question?: unknown; header?: unknown; options?: unknown; multiSelect?: unknown }
  if (typeof q.question !== 'string' || typeof q.header !== 'string') return null
  if (typeof q.multiSelect !== 'boolean' || !Array.isArray(q.options)) return null
  const options: AgentQuestionOption[] = []
  for (const entry of q.options) {
    if (typeof entry !== 'object' || entry === null) return null
    const option = entry as { label?: unknown; description?: unknown }
    if (typeof option.label !== 'string') return null
    if (option.description !== undefined && typeof option.description !== 'string') return null
    options.push(
      option.description !== undefined
        ? { label: option.label, description: option.description }
        : { label: option.label },
    )
  }
  return { question: q.question, header: q.header, multiSelect: q.multiSelect, options }
}

function parseAnswer(value: unknown): QuestionAnswer | null {
  if (typeof value !== 'object' || value === null) return null
  const answer = value as { selected?: unknown; other?: unknown }
  if (!Array.isArray(answer.selected) || !answer.selected.every((s) => typeof s === 'string')) {
    return null
  }
  if (answer.other !== undefined && typeof answer.other !== 'string') return null
  const selected = answer.selected as string[]
  return answer.other !== undefined ? { selected, other: answer.other } : { selected }
}

/**
 * Validated by hand rather than cast, the `serialize.ts` stance: this is data that left the
 * process. An item of an unknown kind is dropped and its neighbours kept, so a transcript
 * written by a newer build still reads here, while a version from the future is refused
 * outright rather than half understood.
 */
export function parseTranscript(text: string): ChatItem[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof value !== 'object' || value === null) return []
  const envelope = value as { version?: unknown; items?: unknown }
  if (envelope.version !== VERSION) return []
  if (!Array.isArray(envelope.items)) return []

  const items: ChatItem[] = []
  for (const entry of envelope.items) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as { id?: unknown; kind?: unknown; text?: unknown }
    if (typeof item.id !== 'number' || !Number.isFinite(item.id)) continue
    if (typeof item.kind !== 'string' || !KINDS.has(item.kind)) continue
    if (typeof item.text !== 'string') continue
    if (item.kind === 'question') {
      const source = entry as { question?: unknown; answer?: unknown }
      const question = parseQuestion(source.question)
      if (!question) continue
      const answer = source.answer === undefined ? undefined : parseAnswer(source.answer)
      // A present-but-malformed answer drops the item rather than showing a question as
      // unanswered when it was not.
      if (source.answer !== undefined && answer === null) continue
      const restored: ChatItem = { id: item.id, kind: 'question', text: item.text, question }
      if (answer) restored.answer = answer
      items.push(restored)
      continue
    }
    items.push({ id: item.id, kind: item.kind as ChatItem['kind'], text: item.text })
  }
  return items
}

/**
 * The tail that fits, by count and then by size. Oldest first in both, because the end of a
 * conversation is the part still in play.
 */
export function capItems(
  items: readonly ChatItem[],
  maxItems: number = MAX_ITEMS,
  maxBytes: number = MAX_BYTES,
): ChatItem[] {
  const kept = items.slice(Math.max(0, items.length - maxItems))
  // Measured newest first, one serialization per item rather than one per item dropped.
  // A single thinking block can be tens of kilobytes, so the tail that fits is often a
  // fraction of the tail that is allowed, and re-serializing the whole list to find each
  // boundary cost the save more than writing it did.
  let bytes = 2
  for (let i = kept.length - 1; i >= 0; i--) {
    // The comma this item adds once it is not the only one, so the running total tracks
    // what `JSON.stringify` of the surviving slice will actually measure.
    bytes += JSON.stringify(kept[i]).length + (i === kept.length - 1 ? 0 : 1)
    // The newest item is kept whatever it costs: a transcript with nothing in it says
    // less than one that is over budget.
    if (bytes > maxBytes && i < kept.length - 1) return kept.slice(i + 1)
  }
  return kept
}

export function readSavedTranscript(): ChatItem[] {
  return parseTranscript(readStored(KEY) ?? '')
}

export function saveTranscript(items: readonly ChatItem[]): void {
  // An empty transcript is stored as absence rather than as an empty list, so a cleared
  // chat and one that was never started read the same on the way back in.
  const kept = items.length === 0 ? null : capItems(items)
  writeStored(KEY, kept === null ? null : JSON.stringify({ version: VERSION, items: kept }))
}

export function clearSavedTranscript(): void {
  writeStored(KEY, null)
}

/** Guards the hydrate against StrictMode running the mount effect twice. */
let hydrated = false

export function startTranscriptAutosave(): () => void {
  if (!hydrated) {
    hydrated = true
    const saved = readSavedTranscript()
    if (saved.length > 0) useAgent.getState().load(saved)
  }

  return startDebouncedSave(
    // Only the transcript is worth a write: the status, the draft and whether the card is
    // open all change far more often and none of them are saved.
    (onChange) =>
      useAgent.subscribe((state, previous) => {
        if (state.items !== previous.items) onChange()
      }),
    () => saveTranscript(useAgent.getState().items),
    SAVE_DELAY,
  )
}
