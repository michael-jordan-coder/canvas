import { type ReactElement } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'
import { parts } from './_parts.js'

export const canvasDefaults = { width: 320 }

export interface TabsProps {
  /** Comma separated, because the document holds scalars. See `_parts.ts`. */
  tabs?: string
  body?: string
}

/**
 * Tabs, on Radix's primitive, which is doing the part that is easy to get wrong: arrow keys
 * move between the triggers, the panel is wired to the trigger by ARIA, and focus lands in the
 * right place when the selection changes.
 */
export function Tabs({ tabs = 'Design, Code, Notes', body = '' }: TabsProps): ReactElement {
  const items = parts(tabs)
  const first = items[0] ?? ''

  return (
    <RadixTabs.Root className="tabs" defaultValue={first}>
      <RadixTabs.List className="tabs-list">
        {items.map((tab) => (
          <RadixTabs.Trigger className="tabs-trigger" value={tab} key={tab}>
            {tab}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((tab) => (
        <RadixTabs.Content className="tabs-panel" value={tab} key={tab}>
          {body || tab}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  )
}
