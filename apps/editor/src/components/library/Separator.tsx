import { type ReactElement } from 'react'
import * as RadixSeparator from '@radix-ui/react-separator'

export const canvasDefaults = { width: 200 }

export type SeparatorOrientation = 'horizontal' | 'vertical'

export interface SeparatorProps {
  orientation?: SeparatorOrientation
  /** Decorative means it is a line, not a structural division, so it is hidden from a reader. */
  decorative?: boolean
}

/** A rule, on Radix's primitive, which is entirely about getting that ARIA distinction right. */
export function Separator({
  orientation = 'horizontal',
  decorative = true,
}: SeparatorProps): ReactElement {
  return (
    <RadixSeparator.Root
      className="separator"
      orientation={orientation}
      decorative={decorative}
    />
  )
}
