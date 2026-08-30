import type { ReactElement } from 'react'
import { agentClient } from '../agent/connection'
import { useAgent } from '../agent/agentStore'
import { AssistantBody } from './AgentPanel'
import { PlusIcon } from './icons'
import { PanelResizer } from './PanelResizer'
import { PropertiesPanel } from './PropertiesPanel'
import { ASSISTANT_MIN_WIDTH } from './panelSize'
import styles from './RightPanel.module.css'

/**
 * The tab row, and a component of its own for the reason everything in this column is one:
 * it follows the agent store, and the transcript below it must not re-render because a dot
 * appeared up here.
 *
 * Two tabs rather than a stack with a divider between them, because the two surfaces
 * disagree about density. The properties are dense controls at 11px; the conversation is
 * read, at 13px with a reading line height. Stacked they are adjacent and invite the
 * comparison, and the one that loses it is the conversation, which flattens into a log.
 * Taking turns is what lets each keep its own scale.
 */
function PanelTabs(): ReactElement {
  const open = useAgent((state) => state.open)
  const unseen = useAgent((state) => state.selectionUnseen)
  const setOpen = useAgent((state) => state.setOpen)

  return (
    <div className={styles.tabs}>
      <div className={styles.segments} role="tablist" aria-label="Right panel">
        <button
          type="button"
          role="tab"
          className={styles.segment}
          aria-selected={!open}
          onClick={() => setOpen(false)}
        >
          Properties
          {/*
            * A selection that arrived while a turn was running, which does not pull the tab
            * over. The dot is the whole of what is owed: the properties have nothing to say
            * that will not still be true after the turn.
            */}
          {unseen && <span className={styles.unseen} />}
        </button>
        <button
          type="button"
          role="tab"
          className={styles.segment}
          aria-selected={open}
          // Through the token rather than `setOpen(true)`, so reaching the assistant by
          // clicking its tab puts the caret where reaching it by shortcut does.
          onClick={() => useAgent.getState().openForInput()}
        >
          Assistant
        </button>
      </div>
      {open && (
        <button
          type="button"
          className={styles.iconButton}
          aria-label="New chat"
          title="New chat"
          onClick={() => agentClient.reset()}
        >
          <PlusIcon />
        </button>
      )}
    </div>
  )
}

/**
 * The right column: the properties and the assistant, one at a time.
 *
 * This reads which tab is on and nothing else. Everything that changes on its own schedule
 * is a subscription below it, so the selection changing costs a render of the properties
 * body alone, and a turn arriving costs the transcript alone.
 *
 * Its floor is the assistant's, not the properties': the column has to hold a sentence
 * whichever tab is showing, and a width that is only wide enough half the time is a width
 * that is wrong every time the other tab is on.
 */
export function RightPanel(): ReactElement {
  const open = useAgent((state) => state.open)

  return (
    <aside className={styles.panel}>
      <PanelResizer
        side="right"
        cssVar="--panel-width-right"
        storageKey="figma-canvas:properties-width"
        label="Resize right panel"
        minWidth={ASSISTANT_MIN_WIDTH}
      />
      <PanelTabs />
      {open ? <AssistantBody /> : <PropertiesPanel />}
    </aside>
  )
}
