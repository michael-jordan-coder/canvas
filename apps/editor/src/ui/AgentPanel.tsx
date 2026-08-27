import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react'
import { askPreviewFromLocation } from '../agent/askPreview'
import { agentClient } from '../agent/connection'
import { isConnected, isWorking, useAgent, type ChatItem } from '../agent/agentStore'
import { failureCount, isNearBottom, showsPendingWork, stepsLabel, toRows } from '../agent/chatRows'
import { isAssistantShortcut } from '../input/assistantShortcut'
import { CheckIcon, ChevronIcon, SendIcon, StopIcon } from './icons'
import styles from './AgentPanel.module.css'

/**
 * Read once, from the URL. In `?ask` preview the seeded question is live without a turn to be
 * busy in, since the whole point is to reach a card no conversation is producing.
 */
const askPreview = askPreviewFromLocation()

/**
 * The chat with the design agent, as one of the two things the right panel can be showing.
 *
 * It floated over the canvas as a card before this, which cost it the two things a docked
 * column gives back: it covered the artwork it was editing, and it collided with the tool
 * bar. What it gives up in exchange is being on screen beside the properties, since a
 * segmented control shows one or the other. `state/panelFollow.ts` owns which.
 *
 * Everything it shows lives in the agent store; this component never touches the socket
 * beyond `agentClient`. That is what makes the tab switch cheap: nothing here is state, so
 * unmounting the conversation loses nothing but where it was scrolled to, and that is kept
 * below.
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

/**
 * The loading line, shown while the turn is running but no step has landed to show for it yet.
 *
 * The same sunken pill and breathing pip as a live run of steps, so it reads as the assistant
 * working rather than as a new kind of thing. It is not a button: there is nothing folded to
 * open, since this is the state before the first step exists rather than a record of one.
 */
function Working(): ReactElement {
  return (
    <div className={styles.working}>
      <span className={styles.pip} />
      Working
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
 * A question the assistant put to the person, the one place in the transcript they act rather
 * than read. Interactive while it is the pending one, a record of the choice once answered, and
 * a settled un-actionable record otherwise: the turn ended before it was answered, or it came
 * back from a past session with no live turn to answer to.
 *
 * The question is said above the card, in the transcript's own voice, and the card below it
 * holds only what there is to do about it. That split is the point: the sentence is something
 * the assistant said, and belongs with everything else it has said, while the card is a control
 * and reads as one.
 *
 * Every question confirms with Submit, single select included. A click that answered outright
 * would be the one control in the app with no way back from a slip, and the free text row makes
 * it worse: typing there and then clicking an option would send the click and drop the words.
 * One Submit takes both, and Enter in the field is the same commit for the same reason.
 *
 * The record is the same card with the marks filled and nothing to select, rather than a second
 * vocabulary of chips. What was chosen is read back in the place it was chosen, what was not is
 * still there to be read, and the descriptions still open, so a past question keeps everything
 * that was in front of the person when they answered it.
 *
 * **A row's description is disclosed, not drawn.** The built-in ask tool marks `description`
 * required where our protocol has it optional, so in practice every option arrives with a
 * sentence, and four of them open at the panel's 300px floor is twelve grey lines: a document
 * rather than a card. The chevron is what opens one, and it sits in a fixed leading column
 * exactly as the layers tree's fold does, with a blank of the same width on the rows that have
 * nothing to open. Beside the label it would land wherever the last word happened to end, and
 * where a label ends is the model's business rather than ours: everything in this card that
 * assumed a length or a count broke on the first sentence long enough to test it, and what
 * held was stated as a column, a gutter and a weight instead.
 */
function Question({ item, pending }: { item: ChatItem; pending: boolean }): ReactElement | null {
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [opened, setOpened] = useState<readonly string[]>([])
  const [other, setOther] = useState('')

  const question = item.question
  if (!question) return null

  const answer = item.answer
  const askId = item.askId
  // Answerable only while it is the pending question of a live turn and has no answer yet.
  const live = answer === undefined && pending && askId !== undefined
  const multi = question.multiSelect
  const trimmedOther = other.trim()

  // A single selection is one answer, and the free text row is one of the things it can be, so
  // picking an option clears what was typed and typing clears what was picked. Without that a
  // card that says "pick one" can carry two marks, which is the question answered twice.
  // A multiple selection has no such rule: the typed answer is another of the several.
  const choose = (label: string): void => {
    if (!multi) {
      setChosen([label])
      setOther('')
      return
    }
    setChosen((current) =>
      current.includes(label) ? current.filter((value) => value !== label) : [...current, label],
    )
  }

  const write = (value: string): void => {
    setOther(value)
    if (!multi && value !== '') setChosen([])
  }

  // No rule of one open at a time: the descriptions exist to be compared, and comparing two of
  // them means having two of them on screen.
  const disclose = (label: string): void => {
    setOpened((current) =>
      current.includes(label) ? current.filter((value) => value !== label) : [...current, label],
    )
  }

  const submit = (): void => {
    if (askId === undefined) return
    const selected = [...chosen]
    if (selected.length === 0 && !trimmedOther) return
    agentClient.answer(askId, trimmedOther ? { selected, other: trimmedOther } : { selected })
  }

  // What each row's mark says. Live, it is what the person has picked so far; settled, it is
  // what they picked at the time. An unanswered record marks nothing.
  const marked = (label: string): boolean =>
    live ? chosen.includes(label) : (answer?.selected.includes(label) ?? false)

  return (
    <div className={styles.question}>
      <p className={styles.questionText}>{question.question}</p>
      <div className={styles.card}>
        {question.options.map((option) => {
          const active = marked(option.label)
          const isOpen = opened.includes(option.label)
          const body = (
            <>
              <span className={styles.text}>
                <span className={styles.optionLabel}>{option.label}</span>
                {option.description && isOpen && (
                  <span className={styles.optionDesc}>{option.description}</span>
                )}
              </span>
              <span className={styles.mark}>{active && <CheckIcon size={11} />}</span>
            </>
          )
          return (
            <div key={option.label} className={styles.row}>
              {option.description ? (
                <button
                  type="button"
                  className={styles.chevron}
                  data-expanded={isOpen}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? 'Hide description' : 'Show description'}
                  onClick={() => disclose(option.label)}
                >
                  <ChevronIcon size={12} />
                </button>
              ) : (
                <span className={styles.chevronBlank} aria-hidden="true" />
              )}
              {live ? (
                <button
                  type="button"
                  role={multi ? 'checkbox' : 'radio'}
                  aria-checked={active}
                  className={styles.select}
                  data-active={active}
                  onClick={() => choose(option.label)}
                >
                  {body}
                </button>
              ) : (
                <div className={styles.select} data-active={active} data-record>
                  {body}
                </div>
              )}
            </div>
          )
        })}
        {live ? (
          <div className={styles.row}>
            <span className={styles.chevronBlank} aria-hidden="true" />
            {/* Marked like an option when it is one: in a single selection what is typed here
                is the answer, and the card has to say so where it says it of every other row. */}
            <div className={styles.select} data-active={!multi && trimmedOther !== ''}>
              <input
                className={styles.otherInput}
                value={other}
                placeholder="Something else..."
                aria-label="Other answer"
                onChange={(event) => write(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <span className={styles.mark}>
                {!multi && trimmedOther !== '' && <CheckIcon size={11} />}
              </span>
            </div>
          </div>
        ) : (
          // The typed answer, as a row of its own so a settled card reads back everything that
          // was said. The empty field it was typed into is an affordance, and an affordance
          // does not survive into the record.
          answer?.other && (
            <div className={styles.row}>
              <span className={styles.chevronBlank} aria-hidden="true" />
              <div className={styles.select} data-active data-record>
                <span className={styles.text}>
                  <span className={styles.optionLabel}>{answer.other}</span>
                </span>
                <span className={styles.mark}>
                  <CheckIcon size={11} />
                </span>
              </div>
            </div>
          )
        )}
        {live && (
          <button
            type="button"
            className={styles.submit}
            disabled={chosen.length === 0 && trimmedOther === ''}
            onClick={submit}
          >
            Submit
          </button>
        )}
      </div>
      {!live && answer === undefined && <p className={styles.questionUnanswered}>No answer</p>}
    </div>
  )
}

/**
 * What an empty transcript offers. Three, because a list long enough to browse is a menu, and a
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
 * the panel, a state set once a second re-rendered the whole transcript to move a single
 * number, and an offline sidecar is exactly when the assistant sits showing longest.
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
 * That is the whole reason it is a component: `draft` lives in the store, so a panel that
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

  // Whatever asked for the caret gets it, however the panel was already standing: the token
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
 * Where the transcript was scrolled to the last time the tab left it, and whether it was
 * following the newest message.
 *
 * At module scope for the same reason the typing history group is: the component is not
 * mounted when the value has to survive. Switching tabs unmounts the conversation, and
 * without this a glance at the properties would bring you back to the bottom of a
 * transcript you were reading the middle of. Not persisted, because it is a position in a
 * list, meaningless the moment the list is restored from storage with different rows.
 */
let restingScrollTop: number | null = null
let restingPinned = true

/**
 * The conversation, mounted only while its tab is on.
 *
 * The transcript is the expensive thing to render and it is the thing that changes most, so
 * everything that changes on its own schedule sits below this rather than above it: the
 * draft per keystroke, the reconnect countdown per second. Mounting on demand is the same
 * rule applied to the whole surface, since a turn running behind the properties tab appends
 * a step per tool call and none of them are on screen.
 */
export function AssistantBody(): ReactElement {
  const status = useAgent((state) => state.status)
  const items = useAgent((state) => state.items)
  const pendingAsk = useAgent((state) => state.pendingAsk)
  const setDraft = useAgent((state) => state.setDraft)
  const openForInput = useAgent((state) => state.openForInput)
  const listRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => toRows(items), [items])

  /*
   * Whether the transcript is following the newest message. A ref rather than state because
   * the scroll handler runs at scroll rate and only the jump control renders from it, which
   * is why the boolean is mirrored into state separately and only when it flips.
   */
  const pinned = useRef(restingPinned)
  const [detached, setDetached] = useState(!restingPinned)

  /*
   * Put the transcript back where the tab left it, and keep it there for the next time.
   * A layout effect, so the restored position is the first thing painted rather than a
   * frame of the bottom of the list followed by a jump.
   */
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (restingScrollTop !== null) list.scrollTop = restingScrollTop
    return () => {
      restingScrollTop = list.scrollTop
      restingPinned = pinned.current
    }
  }, [])

  const toBottom = (): void => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
    pinned.current = true
    setDetached(false)
  }

  /*
   * Narrowing the column changes the list's height without firing a scroll event, so a
   * transcript that was following the newest message would silently come off the bottom and
   * stay there. The observer catches every cause at once: the column's own edge, a window
   * resize, and the layers panel being dragged wider across the grid.
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
    <section
      className={styles.panel}
      aria-label="Assistant"
      aria-busy={isWorking(status)}
    >
      {/* No header of its own. The tab row above names it, holds New chat, and is what
          leaving it is done through, so a title and a close button here would be the same
          two things said twice. */}
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
            ) : row.item.kind === 'question' ? (
              <Question
                key={row.key}
                item={row.item}
                // Not while stopping: the turn is being torn down, and the server has already
                // let go of the question, so an answer would land nowhere.
                pending={
                  (askPreview !== null || status === 'busy') &&
                  row.item.askId !== undefined &&
                  pendingAsk === row.item.askId
                }
              />
            ) : (
              <Item key={row.key} item={row.item} />
            ),
          )}
          {showsPendingWork(rows, isWorking(status), pendingAsk !== null) && <Working />}
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

