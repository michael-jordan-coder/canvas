import { useState, type ReactElement } from 'react'

/**
 * How this component wants to be placed on a canvas, declared where the component is.
 *
 * A field fills the room it is given and its height follows, so it is laid out by its width
 * rather than measured at a natural one. That is a fact about the component, so it belongs in
 * the component's file rather than in a table beside it.
 */
export const canvasDefaults = { width: 220 }

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
