import type { ReactElement } from 'react'
import { isPainted, toHex, type RectangleNode, type SceneNode } from '@figma-canvas/document'
import { scene, useNode } from '../state/scene'
import { useUI } from '../state/uiStore'
import { NumberField } from './NumberField'
import styles from './PropertiesPanel.module.css'

export function PropertiesPanel(): ReactElement {
  const selection = useUI((state) => state.selection)
  const node = useNode(selection.length === 1 ? selection[0] : undefined)

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>{node ? node.name : 'Properties'}</header>
      {node && <NodeProperties node={node} />}
    </aside>
  )
}

function NodeProperties({ node }: { node: SceneNode }): ReactElement {
  const fill = isPainted(node) ? node.fills[0] : undefined

  return (
    <div className={styles.sections}>
      <section className={styles.grid}>
        <NumberField
          label="X"
          value={node.transform.tx}
          onCommit={(tx) => scene.update(node.id, { transform: { ...node.transform, tx } })}
        />
        <NumberField
          label="Y"
          value={node.transform.ty}
          onCommit={(ty) => scene.update(node.id, { transform: { ...node.transform, ty } })}
        />
        <NumberField
          label="W"
          value={node.size.width}
          onCommit={(width) => scene.update(node.id, { size: { ...node.size, width } })}
        />
        <NumberField
          label="H"
          value={node.size.height}
          onCommit={(height) => scene.update(node.id, { size: { ...node.size, height } })}
        />
      </section>

      <section className={styles.grid}>
        <NumberField
          label="%"
          value={Math.round(node.opacity * 100)}
          onCommit={(percent) =>
            scene.update(node.id, { opacity: Math.min(1, Math.max(0, percent / 100)) })
          }
        />
        {(node.type === 'rectangle' || node.type === 'frame') && (
          <NumberField
            label="R"
            value={node.cornerRadius}
            onCommit={(cornerRadius) =>
              scene.update<RectangleNode>(node.id, { cornerRadius: Math.max(0, cornerRadius) })
            }
          />
        )}
      </section>

      {fill && (
        <section className={styles.row}>
          {/* An SVG presentation attribute rather than a style attribute, so the dynamic
              color does not become inline CSS. */}
          <svg className={styles.swatch} width="12" height="12" aria-hidden="true">
            <rect width="12" height="12" fill={toHex(fill.color)} />
            <rect width="12" height="12" fill="none" stroke="rgb(0 0 0 / 0.15)" />
          </svg>
          <span className={styles.hex}>{toHex(fill.color).slice(1).toUpperCase()}</span>
        </section>
      )}
    </div>
  )
}
