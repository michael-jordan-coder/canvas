import type { ReactElement } from 'react'
import styles from './SegmentedField.module.css'

interface SegmentedFieldProps<T extends string> {
  label: string
  /** Drops the visible label column where the layout around the control already names it. */
  hideLabel?: boolean
  value: T
  options: readonly {
    readonly value: T
    readonly label: string
    /** Drawn instead of the label text; the label still names the option for assistive tech. */
    readonly icon?: ReactElement
  }[]
  onChange: (value: T) => void
}

/**
 * A row of mutually exclusive choices, all of them visible.
 *
 * A select would hide two of three behind a click, and these are the kind of thing people
 * flip between rather than set once. Which one is on reads as a raised chip on the field
 * tone, so the control needs no colour until it is focused.
 */
export function SegmentedField<T extends string>({
  label,
  hideLabel,
  value,
  options,
  onChange,
}: SegmentedFieldProps<T>): ReactElement {
  return (
    <div className={styles.field}>
      {!hideLabel && <span className={styles.label}>{label}</span>}
      <div className={styles.segments} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.segment}
            aria-pressed={option.value === value}
            aria-label={option.icon ? option.label : undefined}
            title={option.icon ? option.label : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.icon ?? option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
