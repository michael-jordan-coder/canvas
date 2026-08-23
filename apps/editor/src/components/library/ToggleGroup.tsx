import { useState, type ReactElement } from 'react'
import * as RadixToggleGroup from '@radix-ui/react-toggle-group'
import { parts } from './_parts.js'

export interface ToggleGroupProps {
  /** Comma separated, because the document holds scalars. See `_parts.ts`. */
  options?: string
  value?: string
  disabled?: boolean
}

/** A segmented control, on Radix's toggle group, which owns the roving focus between segments. */
export function ToggleGroup({
  options = 'Left, Center, Right',
  value = '',
  disabled = false,
}: ToggleGroupProps): ReactElement {
  const items = parts(options)
  const [chosen, setChosen] = useState(value || (items[0] ?? ''))

  return (
    <RadixToggleGroup.Root
      className="toggle-group"
      type="single"
      value={chosen}
      disabled={disabled}
      // An empty value would leave nothing selected, which a segmented control never is.
      onValueChange={(next) => next && setChosen(next)}
    >
      {items.map((option) => (
        <RadixToggleGroup.Item className="toggle-item" value={option} key={option}>
          {option}
        </RadixToggleGroup.Item>
      ))}
    </RadixToggleGroup.Root>
  )
}
