import { useEffect, useRef, useState, type ComponentType, type ReactElement } from 'react'
import type { NodeId, NodeType, SceneNode } from '@canvas/document'
import { relayout } from '../state/autoLayout'
import { scene, useChildren, useNode } from '../state/scene'
import { useUI } from '../state/uiStore'
import { deepSelectionTarget } from '../state/selectionTarget'
import {
  ChevronIcon,
  EllipseIcon,
  FrameIcon,
  HiddenIcon,
  LockedIcon,
  RectangleIcon,
  TextIcon,
  UnlockedIcon,
  VisibleIcon,
  type IconProps,
} from './icons'
import { PanelResizer } from './PanelResizer'
import { useLayerDrag, type LayerDrag } from './useLayerDrag'
import styles from './LayersPanel.module.css'

/*
 * Keyed by every node type rather than a chain of ternaries falling back to the rectangle.
 * The fallback is what made a new kind show up as a rectangle instead of failing to compile,
 * and the row is the only place in the app that names a node's kind to the reader.
 */
const ICONS: Record<NodeType, ComponentType<IconProps>> = {
  page: FrameIcon,
  frame: FrameIcon,
  rectangle: RectangleIcon,
  ellipse: EllipseIcon,
  text: TextIcon,
}

/**
 * What the row reads, which is the node's name except on text that has not been renamed.
 *
 * A text node called "Text" tells you nothing, and every one of them is called that, so an
 * untouched one shows its own first line instead. Derived rather than written into `name` on
 * every keystroke: the name is the user's to set, and rewriting it would mean a rename could
 * be undone by typing.
 */
function labelOf(node: SceneNode): string {
  if (node.type !== 'text' || node.name !== 'Text') return node.name
  const firstLine = node.characters.split('\n', 1)[0]?.trim() ?? ''
  return firstLine === '' ? node.name : firstLine
}

export function LayersPanel(): ReactElement {
  const roots = useChildren(scene.rootId)
  const drag = useLayerDrag()

  return (
    <aside className={styles.panel}>
      <PanelResizer
        side="left"
        cssVar="--panel-width-left"
        storageKey="figma-canvas:layers-width"
        label="Resize layers panel"
      />
      <header className={styles.header}>Layers</header>
      <div className={styles.tree}>
        {roots.length === 0 ? (
          <div className={styles.empty}>No layers</div>
        ) : (
          /* Reversed, because index 0 is the back of the stack and the topmost thing on the
             canvas belongs at the top of the list. */
          [...roots].reverse().map((node) => <LayerRow key={node.id} id={node.id} drag={drag} />)
        )}
      </div>
    </aside>
  )
}

function LayerRow({ id, drag }: { id: NodeId; drag: LayerDrag }): ReactElement | null {
  const node = useNode(id)
  const children = useChildren(id)
  const selection = useUI((state) => state.selection)
  const setSelection = useUI((state) => state.setSelection)
  const setContext = useUI((state) => state.setContext)
  const toggleInSelection = useUI((state) => state.toggleInSelection)
  const collapsed = useUI((state) => state.collapsed.has(id))
  const setCollapsed = useUI((state) => state.setCollapsed)
  const [renaming, setRenaming] = useState(false)

  if (!node) return null

  const selected = selection.includes(id)
  const hasChildren = children.length > 0
  const Icon = ICONS[node.type]
  const drop = drag.target?.id === id ? drag.target.position : undefined

  return (
    <div className={styles.branch}>
      <div
        className={styles.row}
        data-layer-id={id}
        data-selected={selected}
        data-dimmed={!node.visible}
        data-locked={node.locked}
        data-dragging={drag.dragging === id}
        data-drop={drop}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.chevron}
            data-expanded={!collapsed}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(id, !collapsed)}
          >
            <ChevronIcon size={12} />
          </button>
        ) : (
          /* Childless rows keep the slot so icons and labels line up down the column. */
          <span className={styles.chevronBlank} aria-hidden="true" />
        )}
        {renaming ? (
          /* Starts from what the row reads, so renaming a text layer edits its own words. */
          <RenameField id={id} name={labelOf(node)} onDone={() => setRenaming(false)} />
        ) : (
          <button
            type="button"
            className={styles.name}
            onClick={(event) => {
              // Same toggle canvas shift-click already uses, so a selection built on the
              // canvas can be extended from here and vice versa.
              if (event.shiftKey || event.metaKey || event.ctrlKey) toggleInSelection(id)
              else {
                setSelection([id])
                // The tree names a node outright, so picking one here is the same statement
                // Cmd clicking it on the canvas makes: work at that depth. Without this the
                // next canvas click would spring back out to the frame above it.
                setContext(deepSelectionTarget(scene, id).context)
              }
            }}
            onDoubleClick={() => setRenaming(true)}
            onPointerDown={(event) => drag.start(id, event)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault()
                setRenaming(true)
              }
              if (event.key === 'ArrowLeft' && hasChildren && !collapsed) {
                event.preventDefault()
                setCollapsed(id, true)
              }
              if (event.key === 'ArrowRight' && hasChildren && collapsed) {
                event.preventDefault()
                setCollapsed(id, false)
              }
            }}
            aria-pressed={selected}
          >
            <Icon size={12} />
            <span className={styles.label}>{labelOf(node)}</span>
          </button>
        )}
        <button
          type="button"
          className={styles.lock}
          aria-label={node.locked ? 'Unlock' : 'Lock'}
          onClick={() => scene.update(id, { locked: !node.locked })}
        >
          {node.locked ? <LockedIcon size={12} /> : <UnlockedIcon size={12} />}
        </button>
        <button
          type="button"
          className={styles.visibility}
          aria-label={node.visible ? 'Hide' : 'Show'}
          onClick={() =>
            // A hidden child leaves an auto layout flow, so the siblings close the gap in
            // the same undo step as the toggle.
            scene.transact(() => {
              scene.update(id, { visible: !node.visible })
              relayout(scene, [id])
            })
          }
        >
          {node.visible ? <VisibleIcon size={12} /> : <HiddenIcon size={12} />}
        </button>
      </div>
      {hasChildren && !collapsed && (
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
