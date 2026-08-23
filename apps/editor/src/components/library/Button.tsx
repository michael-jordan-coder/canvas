import { useState, type ReactElement } from 'react'

export interface ButtonProps {
  label?: string
  disabled?: boolean
}

/**
 * A button, which is the one thing in this library that needs no behaviour library.
 *
 * Radix ships primitives for behaviour that is genuinely hard: focus management, keyboard
 * navigation, portals, ARIA wiring. A button has none of that, so wrapping one would be
 * ceremony. It is here unstyled, with a stable class name, exactly like everything else.
 *
 * The press counter is not something a real design system would ship. It is the shortest
 * possible proof that this is a live component rather than a picture of one: a drawing cannot
 * count.
 */
export function Button({ label = 'Button', disabled = false }: ButtonProps): ReactElement {
  const [presses, setPresses] = useState(0)

  return (
    <button
      type="button"
      className="button"
      disabled={disabled}
      onClick={() => setPresses((count) => count + 1)}
    >
      {label}
      {presses > 0 && <span className="button-count">{presses}</span>}
    </button>
  )
}
