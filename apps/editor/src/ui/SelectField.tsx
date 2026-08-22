import type { ReactElement } from 'react'
import styles from './SelectField.module.css'

interface SelectFieldProps {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}

/**
 * One of a fixed set of strings.
 *
 * The options come from the component's own registry entry, so a variant that does not exist
 * cannot be chosen here, and the coercion in the registry only has to answer for values that
 * arrived from a saved file rather than from this panel.
 */
export function SelectField({ label, value, options, onChange }: SelectFieldProps): ReactElement {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select
        className={styles.select}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {/*
          * A value the registry no longer offers still shows, rather than silently reading as
          * the first option: a saved file naming an old variant should say so.
          */}
        {!options.includes(value) && <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
