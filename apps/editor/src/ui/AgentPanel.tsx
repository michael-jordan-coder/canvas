import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react'
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
} from '@canvas/agent-server/protocol'
import { agentClient, toDataUrl } from '../agent/connection'
import { useAgent, type ChatItem } from '../agent/agentStore'
import {
  AssistantIcon,
  ChevronIcon,
  CloseIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  StopIcon,
} from './icons'
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

/** The image types the API accepts; anything else is refused before it is read. */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

function isAcceptedType(type: string): type is Attachment['mimeType'] {
  return (ACCEPTED_TYPES as readonly string[]).includes(type)
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
    <div className={styles.message} data-kind={item.kind}>
      {item.images && item.images.length > 0 && (
        <div className={styles.messageImages}>
          {item.images.map((src, index) => (
            <img key={index} className={styles.messageImage} src={src} alt="Attached reference" />
          ))}
        </div>
      )}
      {item.text}
    </div>
  )
}

export function AgentPanel(): ReactElement {
  const open = useAgent((state) => state.open)
  const setOpen = useAgent((state) => state.setOpen)
  const status = useAgent((state) => state.status)
  const items = useAgent((state) => state.items)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const rows = useMemo(() => toRows(items), [items])
  // Superseded disables everything offline does: there is no socket either way. The
  // difference is the way back, a reclaim on the person's own gesture instead of a timer.
  const detached = status === 'offline' || status === 'superseded'

  /**
   * The one funnel for paste, drop and the picker, so the type filter, the size limit and
   * the cap live in one place. A refused file says why, the way a turn error already does.
   */
  const addFiles = (files: FileList | File[]): void => {
    const refuse = (text: string): void => useAgent.getState().append('error', text)
    let room = MAX_ATTACHMENTS - attachments.length
    for (const file of Array.from(files)) {
      if (!isAcceptedType(file.type)) {
        refuse(`${file.name || 'That file'} is not a PNG, JPEG, GIF or WebP image.`)
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        refuse(
          `${file.name || 'That image'} is over ${Math.round(MAX_ATTACHMENT_BYTES / 1_000_000)} MB.`,
        )
        continue
      }
      if (room <= 0) {
        refuse(`Up to ${MAX_ATTACHMENTS} images go with one message.`)
        break
      }
      room -= 1
      const mimeType = file.type
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result !== 'string') return
        // A data URL is "data:<mime>;base64,<data>"; the wire wants the data alone.
        const base64 = result.slice(result.indexOf(',') + 1)
        setAttachments((current) =>
          current.length < MAX_ATTACHMENTS ? [...current, { base64, mimeType }] : current,
        )
      }
      reader.readAsDataURL(file)
    }
  }

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
        onClick={() => {
          setOpen(true)
          // Opening the assistant is the interaction that reclaims a superseded socket;
          // a no-op in every other status.
          agentClient.reconnect()
        }}
      >
        <AssistantIcon />
      </button>
    )
  }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const text = draft.trim()
    if (status !== 'idle') return
    if (!text && attachments.length === 0) return
    // An image alone is a legitimate message, but an empty text block is not valid content.
    agentClient.send(
      text || 'Use this image as a design reference.',
      attachments.length > 0 ? attachments : undefined,
    )
    setDraft('')
    setAttachments([])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit(event)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (event.clipboardData.files.length === 0) return
    // Only a file paste is intercepted; pasted text keeps its default behaviour.
    event.preventDefault()
    addFiles(event.clipboardData.files)
  }

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    if (detached) return
    addFiles(event.dataTransfer.files)
  }

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    if (event.target.files) addFiles(event.target.files)
    // Reset so picking the same file again still fires a change.
    event.target.value = ''
  }

  return (
    <section
      className={styles.panel}
      aria-label="Assistant"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
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
        {status === 'superseded' && (
          <p className={styles.offline}>
            Another tab is using the assistant.{' '}
            <button
              type="button"
              className={styles.reclaim}
              onClick={() => agentClient.reconnect()}
            >
              Use it here
            </button>
          </p>
        )}
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
        {attachments.length > 0 && (
          <div className={styles.chips}>
            {attachments.map((attachment, index) => (
              <div key={index} className={styles.chip}>
                <img className={styles.chipImage} src={toDataUrl(attachment)} alt="" />
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label="Remove image"
                  onClick={() =>
                    setAttachments((current) => current.filter((_, at) => at !== index))
                  }
                >
                  <CloseIcon size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.field}>
          <textarea
            className={styles.input}
            value={draft}
            rows={1}
            placeholder="Describe a change"
            disabled={detached}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={onPick}
          />
          <button
            type="button"
            className={styles.attach}
            aria-label="Attach image"
            disabled={detached}
            onClick={() => fileRef.current?.click()}
          >
            <PaperclipIcon />
          </button>
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
              disabled={detached || (draft.trim() === '' && attachments.length === 0)}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
