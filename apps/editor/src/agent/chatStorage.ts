import { useAgent, type ChatItem } from './agentStore'

/**
 * The transcript, across a reload.
 *
 * It is worth keeping for a reason beyond convenience: the server holds the conversation as
 * an SDK session that survives the tab, so without this the model remembers a conversation
 * the person can no longer see. What is stored is what was said, never the status, the
 * draft or whether the card was open, all of which are about this moment rather than about
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
])

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
  let kept = items.slice(Math.max(0, items.length - maxItems))
  while (kept.length > 1 && JSON.stringify(kept).length > maxBytes) {
    kept = kept.slice(1)
  }
  return kept
}

export function readSavedTranscript(): ChatItem[] {
  try {
    const text = window.localStorage.getItem(KEY)
    return text === null ? [] : parseTranscript(text)
  } catch {
    return []
  }
}

export function saveTranscript(items: readonly ChatItem[]): void {
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(KEY)
      return
    }
    window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, items: capItems(items) }))
  } catch {
    // Quota exceeded, or storage blocked. The conversation simply does not outlive the tab.
  }
}

export function clearSavedTranscript(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to do: a clear that cannot be written is a transcript that was never saved.
  }
}

/** Guards the hydrate against StrictMode running the mount effect twice. */
let hydrated = false

export function startTranscriptAutosave(): () => void {
  if (!hydrated) {
    hydrated = true
    const saved = readSavedTranscript()
    if (saved.length > 0) useAgent.getState().load(saved)
  }

  let timer: number | undefined

  const flush = (): void => {
    if (timer === undefined) return
    window.clearTimeout(timer)
    timer = undefined
    saveTranscript(useAgent.getState().items)
  }

  const unsubscribe = useAgent.subscribe((state, previous) => {
    if (state.items === previous.items) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      saveTranscript(useAgent.getState().items)
    }, SAVE_DELAY)
  })

  window.addEventListener('pagehide', flush)

  return () => {
    window.clearTimeout(timer)
    unsubscribe()
    window.removeEventListener('pagehide', flush)
  }
}
