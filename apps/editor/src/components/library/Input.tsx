import { useState, type ReactElement } from 'react'

export interface InputProps {
  label?: string
  placeholder?: string
  hint?: string
  invalid?: boolean
  disabled?: boolean
}

/**
 * A labelled text field, uncontrolled from the document's point of view.
 *
 * What you type into it is React state and nothing to do with the scene: the document holds
 * the label and the placeholder, which are the design, while the value is the runtime. That
 * split is the point of mounting components rather than drawing them, and it is why typing
 * here survives a pan, a zoom and an edit to any other node.
 */
export function Input({
  label = 'Label',
  placeholder = 'Type something',
  hint = '',
  invalid = false,
  disabled = false,
}: InputProps): ReactElement {
  const [value, setValue] = useState('')

  return (
    <label className="field">
      {label && <span className="label">{label}</span>}
      <input
        className="control"
        data-invalid={invalid}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {hint && (
        <span className="hint" data-invalid={invalid}>
          {hint}
        </span>
      )}
    </label>
  )
}
