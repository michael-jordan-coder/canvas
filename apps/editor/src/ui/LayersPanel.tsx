import type { ReactElement } from 'react'
import type { NodeId } from '@figma-canvas/document'
import { scene, useChildren, useNode } from '../state/scene'
import { useUI } from '../state/uiStore'
import { EllipseIcon, FrameIcon, HiddenIcon, RectangleIcon, VisibleIcon } from './icons'
import styles from './LayersPanel.module.css'

export function LayersPanel(): ReactElement {
  const roots = useChildren(scene.rootId)

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>Layers</header>
      <div className={styles.tree}>
        {roots.map((node) => (
          <LayerRow key={node.id} id={node.id} />
        ))}
      </div>
    </aside>
  )
}

function LayerRow({ id }: { id: NodeId }): ReactElement | null {
  const node = useNode(id)
  const children = useChildren(id)
  const selection = useUI((state) => state.selection)
  const setSelection = useUI((state) => state.setSelection)

  if (!node) return null

  const selected = selection.includes(id)
  const Icon =
    node.type === 'frame' ? FrameIcon : node.type === 'ellipse' ? EllipseIcon : RectangleIcon

  return (
    <div className={styles.branch}>
      <div className={styles.row} data-selected={selected} data-dimmed={!node.visible}>
        <button
          type="button"
          className={styles.name}
          onClick={() => setSelection([id])}
          aria-pressed={selected}
        >
          <Icon size={12} />
          <span className={styles.label}>{node.name}</span>
        </button>
        <button
          type="button"
          className={styles.visibility}
          aria-label={node.visible ? 'Hide' : 'Show'}
          onClick={() => scene.update(id, { visible: !node.visible })}
        >
          {node.visible ? <VisibleIcon size={12} /> : <HiddenIcon size={12} />}
        </button>
      </div>
      {children.length > 0 && (
        <div className={styles.children}>
          {children.map((child) => (
            <LayerRow key={child.id} id={child.id} />
          ))}
        </div>
      )}
    </div>
  )
}
