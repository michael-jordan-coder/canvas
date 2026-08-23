import { useState, type ReactElement } from 'react'
import * as RadixSelect from '@radix-ui/react-select'
import { parts } from './_parts.js'

export const canvasDefaults = { width: 200 }

export interface SelectProps {
  label?: string
  /** Comma separated, because the document holds scalars. See `_parts.ts`. */
  options?: string
  placeholder?: string
  disabled?: boolean
}

/**
 * A select, on Radix's primitive.
 *
 * The list is portalled, which is the one thing worth knowing about it on a canvas: closed, the
 * node is its trigger and measures as one, and open, the list is drawn by the browser above
 * everything, outside the transform the canvas puts on the layer. That is the right behaviour
 * for a menu and it is why the node's box is the trigger's box.
 */
export function Select({
  label = '',
  options = 'One, Two, Three',
  placeholder = 'Pick one',
  disabled = false,
}: SelectProps): ReactElement {
  const items = parts(options)
  const [value, setValue] = useState('')

  return (
    <div className="select">
      {label && <span className="select-label">{label}</span>}
      <RadixSelect.Root value={value} disabled={disabled} onValueChange={setValue}>
        <RadixSelect.Trigger className="select-trigger">
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className="select-icon">
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className="select-content" position="popper" sideOffset={4}>
            <RadixSelect.Viewport>
              {items.map((option) => (
                <RadixSelect.Item className="select-item" value={option} key={option}>
                  <RadixSelect.ItemText>{option}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  )
}
