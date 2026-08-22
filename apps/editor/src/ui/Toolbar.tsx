import type { ComponentType, ReactElement } from 'react'
import { useUI, type EditorMode, type ToolId } from '../state/uiStore'
import { selectMode, selectTool } from '../state/textEditing'
import {
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

const MODES: ReadonlyArray<{ id: EditorMode; label: string }> = [
  { id: 'design', label: 'Design' },
  { id: 'preview', label: 'Preview' },
]

export function Toolbar(): ReactElement {
  const tool = useUI((state) => state.tool)
  const mode = useUI((state) => state.mode)

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Tools">
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={styles.tool}
          aria-label={label}
          aria-pressed={tool === id}
          // Every one of these draws or selects, and preview mode does neither, so the
          // whole row goes quiet rather than offering tools that would do nothing.
          disabled={mode === 'preview'}
          onClick={() => selectTool(id)}
        >
          <Icon />
        </button>
      ))}
      {/*
        * Words rather than icons, because this is the one control here that changes what the
        * whole editor is doing rather than what the next click will draw.
        */}
      <div className={styles.modes} role="group" aria-label="Mode">
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={styles.mode}
            aria-pressed={mode === id}
            onClick={() => selectMode(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <FileActions />
    </div>
  )
}
