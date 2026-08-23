import { useState, type ReactElement } from 'react'
import * as Label from '@radix-ui/react-label'

/** A field fills the room it is given and its height follows, so it is laid out by its width. */
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
 * split is the point of mounting components rather than drawing them.
 *
 * Radix's Label is here for the one thing it does that a `<label>` does not: it stops a click
 * on the text from selecting it, which is what makes a label feel like part of the control.
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
    <div className="field">
      {label && <Label.Root className="field-label">{label}</Label.Root>}
      <input
        className="field-control"
        data-invalid={invalid}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {hint && (
        <span className="field-hint" data-invalid={invalid}>
          {hint}
        </span>
      )}
    </div>
  )
}
