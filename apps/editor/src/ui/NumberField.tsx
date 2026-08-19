import { useState, type ReactElement } from 'react'
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
  /** Arrow-key step, and the larger one Shift takes. Defaults to 1 and 10. */
  step?: number
  largeStep?: number
}

/**
 * Commits on blur and on Enter, reverts on Escape. While typing, the draft string is held
 * locally so an intermediate value like "-" or "1." never reaches the document.
 */
export function NumberField({
  label,
  value,
  onCommit,
  wide,
  step = 1,
  largeStep = 10,
}: NumberFieldProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  const rounded = Math.round(value * 100) / 100

  const commit = (): void => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft)
    setDraft(null)
    if (Number.isFinite(parsed) && parsed !== rounded) onCommit(parsed)
  }

  return (
    <label className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        value={draft ?? String(rounded)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
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
            // Each arrow press commits its own step, unlike the canvas's arrow-key nudge,
            // which groups a held burst into one undo step. This field is generic and reused
            // across every numeric property with no access to the document's history group,
            // and grouping here would mean giving it one just for this lower-stakes case.
            onCommit(current + (event.key === 'ArrowUp' ? delta : -delta))
          }
        }}
      />
    </label>
  )
}
