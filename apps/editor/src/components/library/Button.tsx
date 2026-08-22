import { useState, type ReactElement } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'small' | 'medium' | 'large'

export interface ButtonProps {
  label?: string
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
}

/**
 * An ordinary React button, and deliberately nothing more clever than that.
 *
 * It is the first thing the canvas mounts rather than draws, so what matters about it is
 * what a canvas impression of a button could not do: it hovers, it focuses, it disables, and
 * it counts its own clicks in state that survives a pan, a zoom and a prop edit.
 *
 * The counter is not something a real design system would ship. It is here because it is the
 * shortest possible proof that this is a live component: a screenshot cannot count.
 */
export function Button({
  label = 'Button',
  variant = 'primary',
  size = 'medium',
  disabled = false,
}: ButtonProps): ReactElement {
  const [presses, setPresses] = useState(0)

  return (
    <button
      type="button"
      className="button"
      data-variant={variant}
      data-size={size}
      disabled={disabled}
      onClick={() => setPresses((count) => count + 1)}
    >
      {label}
      {presses > 0 && <span className="badge">{presses}</span>}
    </button>
  )
}
