import {
  applyToVector,
  IDENTITY,
  invert,
  isAutoLayoutFrame,
  type NodeId,
  type SceneDocument,
  type Vec2,
} from '@figma-canvas/document'
import { alignSelection, type AlignCommand } from '../state/align'
import { relayout, toggleAutoLayout, wrapInAutoLayout } from '../state/autoLayout'
import { reorderSelection } from '../state/order'
import type { EditorMode, ToolId } from '../state/uiStore'
import { isEditingText } from './isEditingText'

export interface KeyboardInputOptions {
  document: SceneDocument
  getSelection: () => readonly NodeId[]
  setSelection: (ids: readonly NodeId[]) => void
  setTool: (tool: ToolId) => void
  /** Design or preview. Every shortcut here edits the document, so preview has none of them. */
  getMode: () => EditorMode
  /** Going inside the selected component, which is the keyboard's half of a double click. */
  enterComponentSource: (id: NodeId, component: string) => void
}

const NUDGE_STEP = 1
const NUDGE_STEP_LARGE = 10

/**
 * The tool shortcuts, keyed by the unmodified letter.
 *
 * All six land together rather than only the new one. The editor had none at all before
 * text, and an app with exactly one tool shortcut reads as an oversight rather than a
 * decision. Guarded by isEditingText like everything else here, so typing a letter into a
 * text node or a panel field does not switch tools underneath it.
 */
const TOOL_KEYS: Record<string, ToolId> = {
  v: 'move',
  h: 'hand',
  f: 'frame',
  r: 'rectangle',
  o: 'ellipse',
  t: 'text',
}

/** Figma's align shortcuts. Distribute and flip have none there either, so neither gets one here. */
const ALIGN_KEYS: Record<string, AlignCommand> = {
  a: 'left',
  d: 'right',
  w: 'top',
  s: 'bottom',
  h: 'centerX',
  v: 'centerY',
}

const ARROW_DELTAS: Record<string, Vec2> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
}

export function createKeyboardInput(options: KeyboardInputOptions): () => void {
  const { document: scene } = options

  // Keys of the nudge burst currently held. A whole burst, however many arrow keys and however
  // many repeats it produces, is one history group: opened on the first keydown, closed once the
  // last of them is released. A held key repeats around 30 times a second, so recording one step
  // per repeat would burn through the 200 step cap in a few seconds of holding a key down.
  const heldNudgeKeys = new Set<string>()

  const deleteSelection = (): void => {
    const selection = options.getSelection()
    if (selection.length === 0) return
    // Parents noted before the removal, because afterwards the nodes cannot say who held them.
    const parents = selection
      .map((id) => scene.getNode(id)?.parent)
      .filter((id): id is NodeId => id != null)
    // One transaction, so this is one undo step, and so the cleared selection is what the
    // step records as its "after". Undoing brings the nodes back and reselects them.
    scene.transact(() => {
      for (const id of selection) scene.remove(id)
      relayout(scene, parents)
      options.setSelection([])
    })
  }

  const selectAll = (): void => {
    const ids = scene
      .getChildren(scene.rootId)
      .filter((node) => node.visible && !node.locked)
      .map((node) => node.id)
    options.setSelection(ids)
  }

  const nudgeSelection = (direction: Vec2, step: number): void => {
    const selection = options.getSelection()
    if (selection.length === 0) return
    const worldDelta = { x: direction.x * step, y: direction.y * step }
    scene.transact(() => {
      for (const id of selection) {
        const node = scene.getNode(id)
        if (!node || node.locked) continue

        // Inside an auto layout frame position belongs to the layout, so an arrow along the
        // flow steps the node one place through it instead, and one across it does nothing.
        const parent = node.parent ? scene.getNode(node.parent) : undefined
        if (isAutoLayoutFrame(parent)) {
          const horizontal = parent.layout.direction === 'horizontal'
          const along = horizontal ? direction.x : direction.y
          if (along !== 0) {
            scene.reorder(id, scene.indexOf(id) + Math.sign(along))
            relayout(scene, [id])
          }
          continue
        }

        const parentWorld = node.parent ? scene.worldTransform(node.parent) : IDENTITY
        const local = applyToVector(invert(parentWorld), worldDelta)
        scene.update(id, {
          transform: { ...node.transform, tx: node.transform.tx + local.x, ty: node.transform.ty + local.y },
        })
      }
    })
  }

  // If focus is lost mid-hold (alt-tab, a system dialog stealing the key), no keyup ever
  // arrives to close the group. Left open, it would silently fold every later edit into this
  // one step until something else happens to close it, so force it shut on blur.
  const onWindowBlur = (): void => {
    if (heldNudgeKeys.size === 0) return
    heldNudgeKeys.clear()
    scene.endHistoryGroup()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditingText(event.target)) return
    /*
     * Nothing in here runs in preview mode. Every one of these shortcuts edits the document,
     * and a Backspace meant for the input someone is typing into on the canvas must not
     * delete the component that input is part of.
     */
    if (options.getMode() === 'preview') return

    const accel = event.metaKey || event.ctrlKey

    /*
     * Enter goes inside the selected thing, which for a component means its own source. The
     * same idea as double clicking it on the canvas, and the layers panel already stops Enter
     * from reaching here while a row is being renamed.
     */
    if (!accel && event.key === 'Enter') {
      const selection = options.getSelection()
      const only = selection.length === 1 ? selection[0] : undefined
      const node = only ? scene.getNode(only) : undefined
      if (node?.type === 'component') {
        event.preventDefault()
        options.enterComponentSource(node.id, node.component)
      }
      return
    }

    if (accel && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      // Held keys repeat around 30 times a second, which would empty a 200 step history in
      // about seven. One press, one step. Flip this if holding to rewind is wanted instead.
      if (event.repeat) return
      if (event.shiftKey) scene.redo()
      else scene.undo()
      return
    }

    // The Windows convention for redo, harmless to support everywhere.
    if (accel && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      if (event.repeat) return
      scene.redo()
      return
    }

    // Cmd+] and Cmd+[ step one place, adding alt jumps all the way, matching Figma.
    if (accel && (event.key === ']' || event.key === '[')) {
      event.preventDefault()
      if (event.repeat) return
      const forward = event.key === ']'
      reorderSelection(
        scene,
        options.getSelection(),
        event.altKey ? (forward ? 'front' : 'back') : forward ? 'forward' : 'backward',
      )
      return
    }

    if (accel && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      if (event.repeat) return
      selectAll()
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (event.repeat) return
      deleteSelection()
      return
    }

    if (event.key === 'Escape') {
      if (options.getSelection().length === 0) return
      event.preventDefault()
      options.setSelection([])
      return
    }

    // Figma's shortcut for auto layout. A single selected frame toggles its own layout;
    // anything else (a text node, a shape, several of anything) is wrapped in a new auto
    // layout frame drawn tight around it, which is the half of the gesture that makes the
    // shortcut usable on a selection that has no frame yet.
    if (!accel && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') {
      const selection = options.getSelection()
      if (selection.length > 0) {
        event.preventDefault()
        if (event.repeat) return
        const first = selection.length === 1 ? selection[0] : undefined
        const only = first ? scene.getNode(first) : undefined
        if (only?.type === 'frame') {
          toggleAutoLayout(scene, only.id)
          return
        }
        // One transaction, so the wrap and the selection moving onto the new frame are a
        // single undo step, and undoing restores both the tree and the old selection.
        scene.transact(() => {
          const frame = wrapInAutoLayout(scene, selection)
          if (frame) options.setSelection([frame.id])
        })
        return
      }
    }

    // Alt-prefixed, so these sit beside v/h/w/s/a/d without colliding with the bare tool
    // letters below, which are guarded to fire only when alt is not held.
    if (!accel && event.altKey) {
      const command = ALIGN_KEYS[event.key.toLowerCase()]
      if (command) {
        event.preventDefault()
        if (event.repeat) return
        alignSelection(scene, options.getSelection(), command)
        return
      }
    }

    // After the accelerator chords above, so Cmd+A and Cmd+R keep meaning what they did.
    if (!accel && !event.altKey) {
      const tool = TOOL_KEYS[event.key.toLowerCase()]
      if (tool) {
        event.preventDefault()
        options.setTool(tool)
        return
      }
    }

    const direction = ARROW_DELTAS[event.key]
    if (direction) {
      if (options.getSelection().length === 0) return
      event.preventDefault()
      if (!heldNudgeKeys.has(event.key)) {
        heldNudgeKeys.add(event.key)
        if (heldNudgeKeys.size === 1) scene.beginHistoryGroup()
      }
      nudgeSelection(direction, event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP)
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!(event.key in ARROW_DELTAS)) return
    if (!heldNudgeKeys.delete(event.key)) return
    if (heldNudgeKeys.size === 0) scene.endHistoryGroup()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onWindowBlur)
  }
}
