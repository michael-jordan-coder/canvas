import { useState, type ReactElement } from 'react'
import styles from './NumberField.module.css'

interface NumberFieldProps {
  label: string
  value: number
  onCommit: (value: number) => void
}

/**
 * Commits on blur and on Enter, reverts on Escape. While typing, the draft string is held
 * locally so an intermediate value like "-" or "1." never reaches the document.
 */
export function NumberField({ label, value, onCommit }: NumberFieldProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  const rounded = Math.round(value * 100) / 100

  const commit = (): void => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft)
    setDraft(null)
    if (Number.isFinite(parsed) && parsed !== rounded) onCommit(parsed)
  }

  return (
    <label className={styles.field}>
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
        }}
      />
    </label>
  )
}
