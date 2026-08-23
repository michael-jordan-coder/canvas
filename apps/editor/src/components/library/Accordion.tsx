import { type ReactElement } from 'react'
import * as RadixAccordion from '@radix-ui/react-accordion'
import { parts } from './_parts.js'

export const canvasDefaults = { width: 320 }

export interface AccordionProps {
  /** Comma separated, because the document holds scalars. See `_parts.ts`. */
  items?: string
  body?: string
  collapsible?: boolean
}

/** An accordion, on Radix's primitive. */
export function Accordion({
  items = 'First, Second, Third',
  body = 'Whatever this section is about.',
  collapsible = true,
}: AccordionProps): ReactElement {
  const sections = parts(items)

  return (
    <RadixAccordion.Root
      className="accordion"
      type="single"
      collapsible={collapsible}
      defaultValue={sections[0]}
    >
      {sections.map((section) => (
        <RadixAccordion.Item className="accordion-item" value={section} key={section}>
          <RadixAccordion.Header className="accordion-header">
            <RadixAccordion.Trigger className="accordion-trigger">
              {section}
              <span className="accordion-chevron" aria-hidden="true">
                <svg viewBox="0 0 12 12" width="12" height="12">
                  <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </span>
            </RadixAccordion.Trigger>
          </RadixAccordion.Header>
          <RadixAccordion.Content className="accordion-panel">{body}</RadixAccordion.Content>
        </RadixAccordion.Item>
      ))}
    </RadixAccordion.Root>
  )
}
