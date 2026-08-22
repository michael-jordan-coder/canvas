import { useState, type ReactElement } from 'react'
import styles from './TextField.module.css'

interface TextFieldProps {
  label: string
  value: string
  onCommit: (value: string) => void
}

/**
 * A string, committed on blur and on Enter, reverted on Escape.
 *
 * The same contract `NumberField` has and for the same reason: the draft is local while it is
 * being typed, so a half typed word never reaches the document and every keystroke does not
 * become a history step. What it does not have is the scrubbing label, since a string has no
 * direction to be dragged in.
 */
export function TextField({ label, value, onCommit }: TextFieldProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    if (draft === null) return
    const next = draft
    setDraft(null)
    if (next !== value) onCommit(next)
  }

  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type="text"
        spellCheck={false}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(null)
            event.currentTarget.blur()
          }
          // Nothing typed here may reach the canvas: a letter would switch tools and
          // Backspace would delete the very node being edited.
          event.stopPropagation()
        }}
      />
    </label>
  )
}
