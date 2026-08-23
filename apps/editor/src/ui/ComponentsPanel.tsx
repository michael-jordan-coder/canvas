import type { ReactElement } from 'react'
import { componentSpecs, useLibrary } from '../components/registry'
import { beginComponentDrag, endComponentDrag } from '../input/componentDrop'
import { ComponentIcon } from './icons'
import styles from './ComponentsPanel.module.css'

/**
 * The component library, as something to drag onto the canvas.
 *
 * It reads the registry and nothing else, so adding a component to the library adds it here
 * with no change to this file. The drag itself is the platform's: the button starts it, the
 * canvas answers it, and neither knows anything about the other beyond the one MIME type
 * they agree on.
 */
export function ComponentsPanel(): ReactElement {
  // Adding a file to the library folder adds a row here, with no reload and no registration.
  useLibrary()

  return (
    <section className={styles.panel} aria-label="Components">
      <header className={styles.header}>Components</header>
      <div className={styles.list}>
        {componentSpecs().map((spec) => (
          <button
            key={spec.key}
            type="button"
            className={styles.item}
            draggable
            onDragStart={(event) => beginComponentDrag(spec, event.dataTransfer)}
            // Fires however the drag ended, a drop on nothing included, so the module level
            // record of what is being dragged cannot outlive the gesture that set it.
            onDragEnd={endComponentDrag}
          >
            <span className={styles.icon}>
              <ComponentIcon />
            </span>
            <span className={styles.name}>{spec.name}</span>
            <span className={styles.path}>{spec.importPath.split('/').pop()}</span>
          </button>
        ))}
      </div>
      <p className={styles.hint}>Drag onto a frame to place a live component.</p>
    </section>
  )
}
