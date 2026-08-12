import type { ComponentType, ReactElement } from 'react'
import { useUI, type ToolId } from '../state/uiStore'
import { EllipseIcon, FrameIcon, HandIcon, MoveIcon, RectangleIcon, type IconProps } from './icons'
import { FileActions } from './FileActions'
import styles from './Toolbar.module.css'

const TOOLS: ReadonlyArray<{ id: ToolId; label: string; Icon: ComponentType<IconProps> }> = [
  { id: 'move', label: 'Move', Icon: MoveIcon },
  { id: 'frame', label: 'Frame', Icon: FrameIcon },
  { id: 'rectangle', label: 'Rectangle', Icon: RectangleIcon },
  { id: 'ellipse', label: 'Ellipse', Icon: EllipseIcon },
  { id: 'hand', label: 'Hand', Icon: HandIcon },
]

export function Toolbar(): ReactElement {
  const tool = useUI((state) => state.tool)
  const setTool = useUI((state) => state.setTool)

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Tools">
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={styles.tool}
          aria-label={label}
          aria-pressed={tool === id}
          onClick={() => setTool(id)}
        >
          <Icon />
        </button>
      ))}
      <FileActions />
    </div>
  )
}
