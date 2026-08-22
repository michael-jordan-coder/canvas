import { useEffect, useRef, useState, type ReactElement } from 'react'
import { scene } from '../state/scene'
import styles from './NumberField.module.css'

interface NumberFieldProps {
  label: string
  value: number
  onCommit: (value: number) => void
  /**
   * Put the label in the panel's shared 40px column instead of the one character one, so a
   * word like "Weight" lines up with the rows above it rather than sitting on its own grid.
   */
  wide?: boolean
  /** Arrow-key step, and the larger one Shift takes. A scrub moves this much per pixel. */
  step?: number
  largeStep?: number
  /**
   * Shows the value without offering to change it, for one that is derived rather than set.
   * Still selectable, so the number can be read off and copied, and still in the same row so
   * the panel's columns do not break around it.
   */
  readOnly?: boolean
}

/** Pointer travel before a press on the label counts as a scrub rather than a click. */
const SCRUB_THRESHOLD = 3

const round2 = (value: number): number => Math.round(value * 100) / 100

interface Scrub {
  pointerId: number
  startX: number
  lastX: number
  /** The value when the label was grabbed, for Escape to put back. */
  startValue: number
  /**
   * Accumulated per move rather than recomputed from total travel, so pressing or releasing
   * Shift mid drag changes the rate from that pixel on instead of re-pricing the whole
   * distance and making the value jump.
   */
  value: number
  /** What the last move asked for. The prop disagreeing means the call site clamped it. */
  committed: number
  /** False until the pointer has travelled the threshold, so a click stays a click. */
  active: boolean
}

/**
 * Commits on blur and on Enter, reverts on Escape. While typing, the draft string is held
 * locally so an intermediate value like "-" or "1." never reaches the document.
 *
 * The label doubles as a scrubber: dragging it sweeps the value, `step` per pixel and
 * `largeStep` with Shift held, committing as it goes so the canvas answers live. The whole
 * sweep is one history group and therefore one undo step, and Escape mid drag restores the
 * grabbed value and aborts the group, leaving no trace.
 */
export function NumberField({
  label,
  value,
  onCommit,
  wide,
  step = 1,
  largeStep = 10,
  readOnly,
}: NumberFieldProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  const scrubRef = useRef<Scrub | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const rounded = round2(value)

  const commit = (): void => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft)
    setDraft(null)
    if (Number.isFinite(parsed) && parsed !== rounded) onCommit(parsed)
  }

  // Escape has to work wherever focus is, since a scrub never focuses anything. Capture
  // phase, so the canvas's own Escape (which clears the selection) does not also fire.
  useEffect(() => {
    if (!scrubbing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const scrub = scrubRef.current
      if (!scrub) return
      event.preventDefault()
      event.stopImmediatePropagation()
      // Restore first, then abort: the abort discards the whole recording, restore
      // included, so the document is back at the start and the history never saw it.
      if (scrub.committed !== scrub.startValue) onCommit(scrub.startValue)
      scene.abortHistoryGroup()
      scrubRef.current = null
      setScrubbing(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [scrubbing, onCommit])

  // The ew-resize cursor has to survive the pointer sweeping across other elements, and
  // cursors live in the stylesheet, so the gesture is a data attribute on the root, the
  // same shape the pan cursor uses on the canvas.
  useEffect(() => {
    if (!scrubbing) return
    document.documentElement.dataset['scrubbing'] = ''
    return () => {
      delete document.documentElement.dataset['scrubbing']
    }
  }, [scrubbing])

  // A remount mid gesture (the node deselected under it) must not leave the group open,
  // where it would silently swallow every later edit. Same net the nudge burst has on blur.
  useEffect(
    () => () => {
      if (scrubRef.current?.active) scene.endHistoryGroup()
    },
    [],
  )

  const className = [styles.field, wide ? styles.wide : '', readOnly ? styles.readOnly : '']
    .filter(Boolean)
    .join(' ')

  return (
    <label className={className}>
      <span
        className={readOnly ? styles.label : `${styles.label} ${styles.scrubbable}`}
        onPointerDown={(event) => {
          if (readOnly || event.button !== 0) return
          scrubRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            lastX: event.clientX,
            startValue: rounded,
            value: rounded,
            committed: rounded,
            active: false,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const scrub = scrubRef.current
          if (!scrub || event.pointerId !== scrub.pointerId) return
          if (!scrub.active) {
            if (Math.abs(event.clientX - scrub.startX) < SCRUB_THRESHOLD) return
            scrub.active = true
            setScrubbing(true)
            setDraft(null)
            // A scrub pours out a commit per pixel on its way to one value, so the whole
            // sweep is grouped into a single undo step. An arrow press below stays its own
            // step, being one deliberate change rather than a path through many.
            scene.beginHistoryGroup()
          }
          // The call site may have clamped the last commit, and the prop is the truth, so
          // the accumulator follows it rather than winding up invisible debt past a bound
          // that a reversal would have to pay off before the value moved again.
          if (rounded !== scrub.committed) scrub.value = rounded
          scrub.value += (event.clientX - scrub.lastX) * (event.shiftKey ? largeStep : step)
          scrub.lastX = event.clientX
          scrub.committed = round2(scrub.value)
          if (scrub.committed !== rounded) onCommit(scrub.committed)
        }}
        onPointerUp={(event) => {
          const scrub = scrubRef.current
          if (!scrub || event.pointerId !== scrub.pointerId) return
          scrubRef.current = null
          if (scrub.active) {
            scene.endHistoryGroup()
            setScrubbing(false)
          }
          // Below the threshold it was a plain click, and the label's native behaviour
          // focuses the input, which is what a click on a label should do.
        }}
        onPointerCancel={(event) => {
          const scrub = scrubRef.current
          if (!scrub || event.pointerId !== scrub.pointerId) return
          scrubRef.current = null
          if (scrub.active) {
            scene.endHistoryGroup()
            setScrubbing(false)
          }
        }}
      >
        {label}
      </span>
      <input
        className={styles.input}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        readOnly={readOnly}
        value={draft ?? String(rounded)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (readOnly) return
          if (event.key === 'Enter') {
            commit()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const parsedDraft = draft === null ? NaN : Number.parseFloat(draft)
            const current = Number.isFinite(parsedDraft) ? parsedDraft : rounded
            const delta = event.shiftKey ? largeStep : step
            setDraft(null)
            // One press, one step, its own undo. The scrub above is what groups, because
            // it sweeps through dozens of values on the way to the one that is meant.
            onCommit(current + (event.key === 'ArrowUp' ? delta : -delta))
          }
        }}
      />
    </label>
  )
}
