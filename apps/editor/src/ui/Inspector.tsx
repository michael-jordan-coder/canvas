import type { ReactElement } from 'react'
import { useUI, type InspectorTab } from '../state/uiStore'
import { CodePanel } from './CodePanel'
import { PropertiesPanel } from './PropertiesPanel'
import styles from './Inspector.module.css'

/**
 * The right hand column, and the one thing that decides which face of the selection is showing.
 *
 * Properties and code are two renderings of one fact: what the selected node is set to. So they
 * share a column and a tab strip rather than sitting side by side, which would make you choose
 * which of two panels about the same node to read.
 */
const TABS: ReadonlyArray<{ id: InspectorTab; label: string }> = [
  { id: 'design', label: 'Design' },
  { id: 'code', label: 'Code' },
]

export function Inspector(): ReactElement {
  const inspector = useUI((state) => state.inspector)
  const mode = useUI((state) => state.mode)
  const setInspector = useUI((state) => state.setInspector)

  return (
    <aside className={styles.inspector}>
      <div className={styles.tabs} role="tablist" aria-label="Inspector">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={inspector === id}
            // Preview runs the document rather than editing it, and reading a component's
            // source is editing it. `setMode` already closes the tab; this stops it reopening.
            disabled={mode === 'preview' && id === 'code'}
            onClick={() => setInspector(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {inspector === 'code' ? <CodePanel /> : <PropertiesPanel />}
    </aside>
  )
}
