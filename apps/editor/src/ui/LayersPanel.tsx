import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { NodeId } from '@figma-canvas/document'
import { scene, useChildren, useNode } from '../state/scene'
import { useUI } from '../state/uiStore'
import { EllipseIcon, FrameIcon, HiddenIcon, RectangleIcon, VisibleIcon } from './icons'
import { useLayerDrag, type LayerDrag } from './useLayerDrag'
import styles from './LayersPanel.module.css'

export function LayersPanel(): ReactElement {
  const roots = useChildren(scene.rootId)
  const drag = useLayerDrag()

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>Layers</header>
      <div className={styles.tree}>
        {/* Reversed, because index 0 is the back of the stack and the topmost thing on the
            canvas belongs at the top of the list. */}
        {[...roots].reverse().map((node) => (
          <LayerRow key={node.id} id={node.id} drag={drag} />
        ))}
      </div>
    </aside>
  )
}

function LayerRow({ id, drag }: { id: NodeId; drag: LayerDrag }): ReactElement | null {
  const node = useNode(id)
  const children = useChildren(id)
  const selection = useUI((state) => state.selection)
  const setSelection = useUI((state) => state.setSelection)
  const [renaming, setRenaming] = useState(false)

  if (!node) return null

  const selected = selection.includes(id)
  const Icon =
    node.type === 'frame' ? FrameIcon : node.type === 'ellipse' ? EllipseIcon : RectangleIcon
  const drop = drag.target?.id === id ? drag.target.position : undefined

  return (
    <div className={styles.branch}>
      <div
        className={styles.row}
        data-layer-id={id}
        data-selected={selected}
        data-dimmed={!node.visible}
        data-dragging={drag.dragging === id}
        data-drop={drop}
      >
        {renaming ? (
          <RenameField id={id} name={node.name} onDone={() => setRenaming(false)} />
        ) : (
          <button
            type="button"
            className={styles.name}
            onClick={() => setSelection([id])}
            onDoubleClick={() => setRenaming(true)}
            onPointerDown={(event) => drag.start(id, event)}
            aria-pressed={selected}
          >
            <Icon size={12} />
            <span className={styles.label}>{node.name}</span>
          </button>
        )}
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
          {[...children].reverse().map((child) => (
            <LayerRow key={child.id} id={child.id} drag={drag} />
          ))}
        </div>
      )}
    </div>
  )
}

function RenameField({
  id,
  name,
  onDone,
}: {
  id: NodeId
  name: string
  onDone: () => void
}): ReactElement {
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const commit = (): void => {
    const trimmed = draft.trim()
    // An empty name would leave a row with nothing to grab or read.
    if (trimmed && trimmed !== name) scene.update(id, { name: trimmed })
    onDone()
  }

  return (
    <input
      ref={inputRef}
      className={styles.rename}
      value={draft}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') onDone()
        // Delete and the z-order shortcuts must not reach the canvas while typing a name.
        event.stopPropagation()
      }}
    />
  )
}
