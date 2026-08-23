import { useState, type ReactElement } from 'react'
import * as RadixSwitch from '@radix-ui/react-switch'

export interface SwitchProps {
  label?: string
  checked?: boolean
  disabled?: boolean
}

/** A switch, on Radix's primitive. `checked` is where it starts, not where it is. */
export function Switch({
  label = 'Switch',
  checked = false,
  disabled = false,
}: SwitchProps): ReactElement {
  const [on, setOn] = useState(checked)

  return (
    <div className="switch">
      <RadixSwitch.Root
        className="switch-track"
        checked={on}
        disabled={disabled}
        onCheckedChange={setOn}
      >
        <RadixSwitch.Thumb className="switch-thumb" />
      </RadixSwitch.Root>
      {label && <span className="switch-label">{label}</span>}
    </div>
  )
}
