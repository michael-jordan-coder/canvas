import { useState, type ReactElement } from 'react'
import * as RadixSlider from '@radix-ui/react-slider'

/** A slider fills the room it is given, so it is laid out by its width. */
export const canvasDefaults = { width: 220 }

export interface SliderProps {
  label?: string
  value?: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}

/**
 * A slider, on Radix's primitive, which is where the keyboard handling lives: arrows, Home,
 * End and Page Up or Down all move the thumb by the right amount, and none of it is here.
 */
export function Slider({
  label = 'Slider',
  value = 50,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
}: SliderProps): ReactElement {
  const [at, setAt] = useState(value)

  return (
    <div className="slider">
      {label && (
        <div className="slider-header">
          <span className="slider-label">{label}</span>
          <span className="slider-value">{at}</span>
        </div>
      )}
      <RadixSlider.Root
        className="slider-root"
        value={[at]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([next]) => setAt(next ?? at)}
      >
        <RadixSlider.Track className="slider-track">
          <RadixSlider.Range className="slider-range" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="slider-thumb" aria-label={label} />
      </RadixSlider.Root>
    </div>
  )
}
