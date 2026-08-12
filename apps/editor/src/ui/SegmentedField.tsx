import type { ReactElement } from 'react'
import styles from './SegmentedField.module.css'

interface SegmentedFieldProps<T extends string> {
  label: string
  value: T
  options: readonly { readonly value: T; readonly label: string }[]
  onChange: (value: T) => void
}

/**
 * A row of mutually exclusive choices, all of them visible.
 *
 * A select would hide two of three behind a click, and these are the kind of thing people
 * flip between rather than set once. Which one is on is carried by the accent, since that
 * is the only thing on screen allowed to be a colour.
 */
export function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedFieldProps<T>): ReactElement {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.segments} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.segment}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
