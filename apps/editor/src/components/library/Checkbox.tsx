import { useState, type ReactElement } from 'react'
import * as RadixCheckbox from '@radix-ui/react-checkbox'

export interface CheckboxProps {
  label?: string
  checked?: boolean
  disabled?: boolean
}

/**
 * A checkbox, on Radix's primitive.
 *
 * `checked` is the starting state rather than the live one, which is the rule every control in
 * this library follows: the document holds what the design says, and what the component is
 * doing right now is React state that survives a pan, a zoom and an edit to another node.
 */
export function Checkbox({
  label = 'Checkbox',
  checked = false,
  disabled = false,
}: CheckboxProps): ReactElement {
  const [on, setOn] = useState(checked)

  return (
    <div className="checkbox">
      <RadixCheckbox.Root
        className="checkbox-box"
        checked={on}
        disabled={disabled}
        onCheckedChange={(next) => setOn(next === true)}
      >
        <RadixCheckbox.Indicator className="checkbox-mark">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2 6.2 4.7 9 10 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {label && <span className="checkbox-label">{label}</span>}
    </div>
  )
}
