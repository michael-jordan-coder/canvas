import type { ComponentType, ReactElement } from 'react'
import { isWorking, useAgent } from '../agent/agentStore'
import { useUI, type ToolId } from '../state/uiStore'
import { insertCodeNode } from '../state/code'
import { selectTool } from '../state/textEditing'
import {
  AssistantIcon,
  CodeIcon,
  EllipseIcon,
  FrameIcon,
  HandIcon,
  MoveIcon,
  RectangleIcon,
  TextIcon,
  type IconProps,
} from './icons'
import styles from './Toolbar.module.css'

/** One size for every icon in the bar, so a button added later cannot arrive at 16. */
const ICON_SIZE = 20

const TOOLS: ReadonlyArray<{ id: ToolId; label: string; Icon: ComponentType<IconProps> }> = [
  { id: 'move', label: 'Move', Icon: MoveIcon },
  { id: 'frame', label: 'Frame', Icon: FrameIcon },
  { id: 'rectangle', label: 'Rectangle', Icon: RectangleIcon },
  { id: 'ellipse', label: 'Ellipse', Icon: EllipseIcon },
  { id: 'text', label: 'Text', Icon: TextIcon },
  { id: 'hand', label: 'Hand', Icon: HandIcon },
]

/**
 * The assistant's opener, and a component rather than a seventh entry in the list above
 * because it is the only thing in the bar that follows the agent's status: the bar has no
 * business re-rendering its tools every time a turn starts or ends.
 *
 * It is a toggle: it puts the right panel on the assistant's tab, and pressed again puts it
 * back on the properties. Showing takes the accent fill an active tool takes; a turn running
 * while the properties are showing takes the accent as a colour instead, which is the one
 * place the assistant's status is on screen when its own tab is not.
 */
function AssistantButton(): ReactElement {
  const open = useAgent((state) => state.open)
  // The boolean rather than the status it comes from: zustand compares what the selector
  // returns, so six statuses collapse to the two the button can actually draw, and the
  // reconnect backoff cycling offline and connecting re-renders nothing.
  const busy = useAgent((state) => isWorking(state.status))
  const setOpen = useAgent((state) => state.setOpen)
  const openForInput = useAgent((state) => state.openForInput)

  return (
    <button
      type="button"
      className={styles.tool}
      aria-label="Assistant"
      title="Assistant"
      aria-pressed={open}
      data-busy={busy}
      // Opening puts the caret in the composer, exactly as the shortcut does: a panel opened
      // to be typed into and then clicked into is two gestures for one intention.
      onClick={() => (open ? setOpen(false) : openForInput())}
    >
      <AssistantIcon size={ICON_SIZE} />
    </button>
  )
}

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
          <Icon size={ICON_SIZE} />
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
        <CodeIcon size={ICON_SIZE} />
      </button>
      {/* Not a tool: it opens a surface rather than changing what the pointer does, so it
          sits behind a hairline rather than in the run of them. */}
      <span className={styles.divider} />
      <AssistantButton />
    </div>
  )
}
