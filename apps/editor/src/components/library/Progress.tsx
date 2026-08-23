import { type CSSProperties, type ReactElement } from 'react'
import * as RadixProgress from '@radix-ui/react-progress'

export const canvasDefaults = { width: 220 }

export interface ProgressProps {
  label?: string
  value?: number
  max?: number
}

/** A progress bar, on Radix's primitive, which carries the ARIA a bare div would not. */
export function Progress({ label = '', value = 60, max = 100 }: ProgressProps): ReactElement {
  const clamped = Math.max(0, Math.min(value, max))

  return (
    <div className="progress">
      {label && <span className="progress-label">{label}</span>}
      <RadixProgress.Root className="progress-track" value={clamped} max={max}>
        {/*
          * The one value that cannot be static, passed as a custom property rather than as a
          * width. Everything about how the bar looks stays in the stylesheet, which is what
          * lets the canvas edit it: an inline width would win against anything written there.
          */}
        <RadixProgress.Indicator
          className="progress-bar"
          style={{ '--progress': `${(clamped / max) * 100}%` } as CSSProperties}
        />
      </RadixProgress.Root>
    </div>
  )
}
