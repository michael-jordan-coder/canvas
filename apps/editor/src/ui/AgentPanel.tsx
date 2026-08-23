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

/** A tool name the model saw, as a line a person can read: "create_frame" to "create frame". */
function humanize(name: string): string {
  return name.replaceAll('_', ' ')
}

/**
 * Tool calls and thinking are process, not conversation, so a consecutive run of them folds
 * into one row. The messages stay flat in the store; the fold is purely presentational.
 */
type Row =
  | { key: string; kind: 'item'; item: ChatItem }
  | { key: string; kind: 'steps'; items: ChatItem[] }

function toRows(items: ChatItem[]): Row[] {
  const rows: Row[] = []
  for (const item of items) {
    const folds = item.kind === 'tool' || item.kind === 'thinking'
    const last = rows[rows.length - 1]
    if (folds && last?.kind === 'steps') {
      last.items.push(item)
    } else if (folds) {
      rows.push({ key: `steps-${item.id}`, kind: 'steps', items: [item] })
    } else {
      rows.push({ key: `item-${item.id}`, kind: 'item', item })
    }
  }
  return rows
}

/**
 * One folded run. Closed it is a single line: the step count once done, or the step in
 * progress while the run is still growing, so the live line doubles as the activity readout.
 */
function Steps({ items, live }: { items: ChatItem[]; live: boolean }): ReactElement {
  const [open, setOpen] = useState(false)
  const latest = items[items.length - 1]
  const label =
    live && latest
      ? latest.kind === 'thinking'
        ? 'Thinking'
        : humanize(latest.text)
      : `${items.length} ${items.length === 1 ? 'step' : 'steps'}`

  return (
    <div className={styles.steps}>
      <button
        type="button"
        className={styles.stepsToggle}
        data-open={open}
        data-live={live}
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
              <p key={item.id} className={styles.step}>
                {humanize(item.text)}
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

export function AgentPanel(): ReactElement {
  const open = useAgent((state) => state.open)
  const setOpen = useAgent((state) => state.setOpen)
  const status = useAgent((state) => state.status)
  const items = useAgent((state) => state.items)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => toRows(items), [items])

  // Pinned to the newest message. The transcript grows from the bottom the way every chat
  // does, so anything else would hide exactly what just happened.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [items])

  if (!open) {
    return (
      <button
        type="button"
        className={styles.opener}
        aria-label="Assistant"
        data-busy={status === 'busy'}
        onClick={() => setOpen(true)}
      >
        <AssistantIcon />
      </button>
    )
  }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || status !== 'idle') return
    agentClient.send(text)
    setDraft('')
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

      <div ref={listRef} className={styles.list}>
        {status === 'offline' && <p className={styles.offline}>Agent server offline.</p>}
        {rows.map((row, index) =>
          row.kind === 'steps' ? (
            <Steps
              key={row.key}
              items={row.items}
              live={status === 'busy' && index === rows.length - 1}
            />
          ) : (
            <Item key={row.key} item={row.item} />
          ),
        )}
      </div>

      <form className={styles.composer} onSubmit={submit}>
        <div className={styles.field}>
          <textarea
            className={styles.input}
            value={draft}
            rows={1}
            placeholder="Describe a change"
            disabled={status === 'offline'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {status === 'busy' ? (
            <button
              type="button"
              className={styles.action}
              aria-label="Stop"
              onClick={() => agentClient.stop()}
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="submit"
              className={styles.action}
              aria-label="Send"
              disabled={status === 'offline' || draft.trim() === ''}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
