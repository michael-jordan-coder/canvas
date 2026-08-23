import { useState, type ReactElement } from 'react'
import * as RadixRadio from '@radix-ui/react-radio-group'
import { parts } from './_parts.js'

export const canvasDefaults = { width: 200 }

export interface RadioGroupProps {
  label?: string
  /** Comma separated, because the document holds scalars. See `_parts.ts`. */
  options?: string
  value?: string
  disabled?: boolean
}

/** A radio group, on Radix's primitive, which owns the roving focus between the options. */
export function RadioGroup({
  label = 'Choose one',
  options = 'One, Two, Three',
  value = '',
  disabled = false,
}: RadioGroupProps): ReactElement {
  const items = parts(options)
  const [chosen, setChosen] = useState(value || (items[0] ?? ''))

  return (
    <div className="radio">
      {label && <span className="radio-label">{label}</span>}
      <RadixRadio.Root
        className="radio-root"
        value={chosen}
        disabled={disabled}
        onValueChange={setChosen}
      >
        {items.map((option) => (
          <label className="radio-option" key={option}>
            <RadixRadio.Item className="radio-item" value={option}>
              <RadixRadio.Indicator className="radio-dot" />
            </RadixRadio.Item>
            <span className="radio-text">{option}</span>
          </label>
        ))}
      </RadixRadio.Root>
    </div>
  )
}
