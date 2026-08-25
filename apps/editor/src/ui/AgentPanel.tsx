import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react'
import { agentClient } from '../agent/connection'
import { isConnected, isWorking, useAgent, type ChatItem } from '../agent/agentStore'
import { failureCount, isNearBottom, stepsLabel, toRows } from '../agent/chatRows'
import { isAssistantShortcut } from '../input/assistantShortcut'
import { CornerGrip } from './CornerGrip'
import { AssistantIcon, ChevronIcon, CloseIcon, PlusIcon, SendIcon, StopIcon } from './icons'
import styles from './AgentPanel.module.css'

/**
 * The chat with the design agent, floating over the viewport's corner.
 *
 * A floating card rather than a fourth panel column, because the conversation is transient
 * in a way the layers tree and the properties are not: it comes out when there is something
 * to ask and gets out of the way of the canvas it edits. Everything it shows lives in the
 * agent store; this component never touches the socket beyond `agentClient`.
 */

/**
 * One folded run. Closed it is a single line: the step count once done, or the step in
 * progress while the run is still growing, so the live line doubles as the activity readout.
 * A run holding a failed step says so, since that is the one reason to open a settled run.
 */
function Steps({ items, live }: { items: ChatItem[]; live: boolean }): ReactElement {
  const [open, setOpen] = useState(false)
  const failed = failureCount(items) > 0
  const label = stepsLabel(items, live)

  // A failure opens its own run. Everything else in here is process the person can ignore,
  // which is the whole reason it folds; a step that did not work is the exception, and
  // leaving it behind a click means it is found after the turn rather than during it.
  useEffect(() => {
    if (failed) setOpen(true)
  }, [failed])

  return (
    <div className={styles.steps}>
      <button
        type="button"
        className={styles.stepsToggle}
        data-open={open}
        data-live={live}
        data-failed={failed}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.pip} />
        {label}
        <ChevronIcon size={12} />
      </button>
      {open && (
        <div className={styles.stepsBody}>
          {items.map((item) =>
            item.kind === 'thinking' ? (
              <p key={item.id} className={styles.thought}>
                {item.text}
              </p>
            ) : (
              <p key={item.id} className={styles.step} data-failed={item.kind === 'tool-error'}>
                {item.text}
              </p>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function Item({ item }: { item: ChatItem }): ReactElement {
  return (
    <p className={styles.message} data-kind={item.kind}>
      {item.text}
    </p>
  )
}

/**
 * What an empty card offers. Three, because a list long enough to browse is a menu, and a
 * menu is a different promise from a conversation. Each one is a real request this canvas
 * can answer, and the last is there to say that code is on the table at all.
 */
const SUGGESTIONS: readonly string[] = [
  'Design a sign in screen',
  'Make a pricing card with three tiers',
  'Build a counter I can click, with code',
]

/** Seconds until the next automatic reconnect, or null when none is scheduled. */
function useCountdown(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === null) return
    // Read the clock before the first tick, not only on it. No interval runs while nothing
    // is scheduled, so `now` is otherwise as old as the last time one was, and the first
    // frame of a fresh countdown starts from a minute ago.
    setNow(Date.now())
    // A second is the resolution the text shows, so nothing finer is worth a render.
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [at])
  if (at === null) return null
  return Math.max(0, Math.ceil((at - now) / 1000))
}

/**
 * The connection strip, and the countdown in it.
 *
 * Its own component so the tick is scoped to the one line that shows it. Left at the top of
 * the card, a state set once a second re-rendered the whole transcript to move a single
 * number, and an offline sidecar is exactly when the card sits open longest.
 */
function ConnectionStrip(): ReactElement | null {
  const status = useAgent((state) => state.status)
  const nextAttemptAt = useAgent((state) => state.nextAttemptAt)
  const seconds = useCountdown(status === 'offline' ? nextAttemptAt : null)

  if (isConnected(status)) return null

  // Displaced is the one case here that is not a wait, so it names a place rather than a
  // fault, and its control asks for the assistant back rather than trying again.
  const displaced = status === 'displaced'

  return (
    <div className={styles.connection}>
      <span className={styles.connectionText}>
        {displaced
          ? 'The assistant is open in another tab'
          : status === 'connecting'
            ? 'Connecting to the agent server'
            : seconds === null
              ? 'Agent server offline'
              : `Agent server offline. Retrying in ${seconds}s`}
      </span>
      <button
        type="button"
        className={styles.retry}
        disabled={status === 'connecting'}
        onClick={() => agentClient.reconnect()}
      >
        {displaced ? 'Use it here' : 'Retry'}
      </button>
    </div>
  )
}

/**
 * The composer, which is the only thing here that changes per keystroke.
 *
 * That is the whole reason it is a component: `draft` lives in the store, so a card that
 * read it at the top re-rendered every row of the transcript on every character typed. It
 * is the field and the one button beside it that have to follow the draft, and nothing
 * else does.
 */
function Composer(): ReactElement {
  const status = useAgent((state) => state.status)
  const draft = useAgent((state) => state.draft)
  const setDraft = useAgent((state) => state.setDraft)
  const setOpen = useAgent((state) => state.setOpen)
  const focusToken = useAgent((state) => state.focusToken)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const connected = isConnected(status)

  // Whatever asked for the caret gets it, however the card was already standing: the token
  // changes even when `open` does not, which is what makes the shortcut work twice.
  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus()
  }, [focusToken])

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || status !== 'idle') return
    // The draft is cleared only once the socket has taken it. A message the server never
    // heard would otherwise vanish from the composer and from the transcript alike.
    if (agentClient.send(text)) setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    /*
     * The shortcut closes from in here, because the window handler will never see it: its
     * first line hands every keystroke in a text field back to the field. Escape does the
     * same, matching what Escape means everywhere else in the editor, and both stop here so
     * the canvas does not also act on them.
     */
    if (isAssistantShortcut(event) || event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit(event)
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <div className={styles.field}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={draft}
          rows={1}
          placeholder={
            connected
              ? 'Describe a change'
              : status === 'displaced'
                ? 'Open in another tab'
                : 'Waiting for the agent server'
          }
          disabled={!connected}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {isWorking(status) ? (
          <button
            type="button"
            className={styles.action}
            aria-label="Stop"
            disabled={status === 'stopping'}
            onClick={() => agentClient.stop()}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            className={styles.action}
            aria-label="Send"
            disabled={!connected || draft.trim() === ''}
          >
            <SendIcon />
          </button>
        )}
      </div>
    </form>
  )
}

/**
 * The card itself, mounted only while it is open.
 *
 * The transcript is the expensive thing to render and it is the thing that changes most, so
 * everything that changes on its own schedule sits below this rather than above it: the
 * draft per keystroke, the reconnect countdown per second. Mounting on open is the same
 * rule applied to the card as a whole, since a turn running behind a closed card appends a
 * step per tool call and none of them are on screen.
 */
function Card(): ReactElement {
  const status = useAgent((state) => state.status)
  const items = useAgent((state) => state.items)
  const setOpen = useAgent((state) => state.setOpen)
  const setDraft = useAgent((state) => state.setDraft)
  const openForInput = useAgent((state) => state.openForInput)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const rows = useMemo(() => toRows(items), [items])

  /*
   * Whether the transcript is following the newest message. A ref rather than state because
   * the scroll handler runs at scroll rate and only the jump control renders from it, which
   * is why the boolean is mirrored into state separately and only when it flips.
   */
  const pinned = useRef(true)
  const [detached, setDetached] = useState(false)

  const toBottom = (): void => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
    pinned.current = true
    setDetached(false)
  }

  /*
   * Shrinking the card changes the list's height without firing a scroll event, so a
   * transcript that was following the newest message would silently come off the bottom and
   * stay there. The observer catches every cause at once: the grip, a window resize, and a
   * panel being dragged wider beside it.
   */
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const observer = new ResizeObserver(() => {
      if (pinned.current) list.scrollTop = list.scrollHeight
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  // Pinned to the newest message, but only while it is the one being read. A transcript that
  // pinned unconditionally could not be scrolled back during a turn: every arriving step
  // would drag it down again, which is exactly when there is most to read.
  useEffect(() => {
    const list = listRef.current
    if (list && pinned.current) list.scrollTop = list.scrollHeight
  }, [items])

  return (
    <section ref={panelRef} className={styles.panel} aria-label="Assistant" aria-busy={isWorking(status)}>
      <CornerGrip targetRef={panelRef} />
      <header className={styles.header}>
        <span className={styles.status} data-status={status} />
        <h2 className={styles.title}>Assistant</h2>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="New chat"
          title="New chat"
          onClick={() => agentClient.reset()}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close"
          title="Close"
          onClick={() => setOpen(false)}
        >
          <CloseIcon />
        </button>
      </header>

      <div className={styles.transcript}>
        <div
          ref={listRef}
          className={styles.list}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
          onScroll={() => {
            const list = listRef.current
            if (!list) return
            const near = isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)
            pinned.current = near
            setDetached(!near)
          }}
        >
          {rows.length === 0 && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Ask for a change, or start from one of these.</p>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={styles.suggestion}
                  // Into the composer rather than straight to the server: a suggestion is a
                  // starting point, and the person should get to change it before it is sent.
                  // The caret is asked for through the same token the shortcut uses, since
                  // the field itself is a component away from here.
                  onClick={() => {
                    setDraft(suggestion)
                    openForInput()
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {rows.map((row, index) =>
            row.kind === 'steps' ? (
              <Steps
                key={row.key}
                items={row.items}
                live={isWorking(status) && index === rows.length - 1}
              />
            ) : (
              <Item key={row.key} item={row.item} />
            ),
          )}
        </div>
        {detached && (
          <button type="button" className={styles.jump} onClick={toBottom}>
            Jump to latest
          </button>
        )}
      </div>

      <ConnectionStrip />
      <Composer />
    </section>
  )
}

/**
 * The assistant, which is a button until it is a card.
 *
 * This reads `open` and `status` and nothing else, so a turn running behind a closed card
 * costs one render of one button per status change rather than a render of the transcript
 * per step.
 */
export function AgentPanel(): ReactElement {
  const open = useAgent((state) => state.open)
  const setOpen = useAgent((state) => state.setOpen)
  const status = useAgent((state) => state.status)

  if (!open) {
    return (
      <button
        type="button"
        className={styles.opener}
        aria-label="Assistant"
        title="Assistant"
        data-busy={isWorking(status)}
        onClick={() => setOpen(true)}
      >
        <AssistantIcon size={18} />
      </button>
    )
  }

  return <Card />
}
