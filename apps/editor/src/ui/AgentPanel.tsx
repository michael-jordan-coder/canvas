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
import { useAgent, type ChatItem } from '../agent/agentStore'
import { hasFailure, humanize, isNearBottom, toRows } from '../agent/chatRows'
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
  const latest = items[items.length - 1]
  const failed = hasFailure(items)
  const count = `${items.length} ${items.length === 1 ? 'step' : 'steps'}`
  const label =
    live && latest
      ? latest.kind === 'thinking'
        ? 'Thinking'
        : humanize(latest.text)
      : failed
        ? `${count}, one failed`
        : count

  return (
    <div className={styles.steps}>
      <button
        type="button"
        className={styles.stepsToggle}
        data-open={open}
        data-live={live}
        data-failed={failed}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronIcon size={12} />
        {label}
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
                {item.kind === 'tool-error' ? item.text : humanize(item.text)}
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

/** Seconds until the next automatic reconnect, or null when none is scheduled. */
function useCountdown(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === null) return
    // A second is the resolution the text shows, so nothing finer is worth a render.
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [at])
  if (at === null) return null
  return Math.max(0, Math.ceil((at - now) / 1000))
}

export function AgentPanel(): ReactElement {
  const open = useAgent((state) => state.open)
  const setOpen = useAgent((state) => state.setOpen)
  const status = useAgent((state) => state.status)
  const items = useAgent((state) => state.items)
  const nextAttemptAt = useAgent((state) => state.nextAttemptAt)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => toRows(items), [items])
  const seconds = useCountdown(status === 'offline' ? nextAttemptAt : null)

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

  // Pinned to the newest message, but only while it is the one being read. A transcript that
  // pinned unconditionally could not be scrolled back during a turn: every arriving step
  // would drag it down again, which is exactly when there is most to read.
  useEffect(() => {
    const list = listRef.current
    if (list && pinned.current) list.scrollTop = list.scrollHeight
  }, [items])

  if (!open) {
    return (
      <button
        type="button"
        className={styles.opener}
        aria-label="Assistant"
        data-busy={status === 'busy' || status === 'stopping'}
        onClick={() => setOpen(true)}
      >
        <AssistantIcon />
      </button>
    )
  }

  const connected = status === 'idle' || status === 'busy' || status === 'stopping'

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || status !== 'idle') return
    // The draft is cleared only once the socket has taken it. A message the server never
    // heard would otherwise vanish from the composer and from the transcript alike.
    if (agentClient.send(text)) setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit(event)
    }
  }

  return (
    <section className={styles.panel} aria-label="Assistant">
      <header className={styles.header}>
        <span className={styles.status} data-status={status} />
        <h2 className={styles.title}>Assistant</h2>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="New chat"
          onClick={() => agentClient.reset()}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close"
          onClick={() => setOpen(false)}
        >
          <CloseIcon />
        </button>
      </header>

      <div className={styles.transcript}>
        <div
          ref={listRef}
          className={styles.list}
          onScroll={() => {
            const list = listRef.current
            if (!list) return
            const near = isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)
            pinned.current = near
            setDetached(!near)
          }}
        >
          {rows.map((row, index) =>
            row.kind === 'steps' ? (
              <Steps
                key={row.key}
                items={row.items}
                live={
                  (status === 'busy' || status === 'stopping') && index === rows.length - 1
                }
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

      {!connected && (
        <div className={styles.connection}>
          <span className={styles.connectionText}>
            {status === 'connecting'
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
            Retry
          </button>
        </div>
      )}

      <form className={styles.composer} onSubmit={submit}>
        <div className={styles.field}>
          <textarea
            className={styles.input}
            value={draft}
            rows={1}
            placeholder={connected ? 'Describe a change' : 'Waiting for the agent server'}
            disabled={!connected}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {status === 'busy' || status === 'stopping' ? (
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
    </section>
  )
}
