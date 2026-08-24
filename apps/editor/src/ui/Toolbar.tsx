import type { ComponentType, ReactElement } from 'react'
import { useUI, type ToolId } from '../state/uiStore'
import { insertCodeNode } from '../state/code'
import { selectTool } from '../state/textEditing'
import {
  CodeIcon,
  EllipseIcon,
  FrameIcon,
  HandIcon,
  MoveIcon,
  RectangleIcon,
  TextIcon,
  type IconProps,
} from './icons'
import { FileActions } from './FileActions'
import styles from './Toolbar.module.css'

const TOOLS: ReadonlyArray<{ id: ToolId; label: string; Icon: ComponentType<IconProps> }> = [
  { id: 'move', label: 'Move', Icon: MoveIcon },
  { id: 'frame', label: 'Frame', Icon: FrameIcon },
  { id: 'rectangle', label: 'Rectangle', Icon: RectangleIcon },
  { id: 'ellipse', label: 'Ellipse', Icon: EllipseIcon },
  { id: 'text', label: 'Text', Icon: TextIcon },
  { id: 'hand', label: 'Hand', Icon: HandIcon },
]

export function Toolbar(): ReactElement {
  const tool = useUI((state) => state.tool)

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Tools">
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={styles.tool}
          aria-label={label}
          aria-pressed={tool === id}
          onClick={() => selectTool(id)}
        >
          <Icon />
        </button>
      ))}
      {/*
        * An insert, not a tool: a code node arrives with a working starter rather than
        * being dragged out empty, because an empty code node is a box that draws nothing.
        */}
      <button
        type="button"
        className={styles.tool}
        aria-label="Insert code node"
        onClick={insertCodeNode}
      >
        <CodeIcon />
      </button>
      <FileActions />
    </div>
  )
}
