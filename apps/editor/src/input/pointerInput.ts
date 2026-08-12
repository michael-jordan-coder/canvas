import {
  applyToPoint,
  hitTest,
  invert,
  type Mat2D,
  type NodeId,
  type SceneDocument,
  type Vec2,
} from '@figma-canvas/document'
import { screenToWorld, type Camera, type Viewport } from '@figma-canvas/renderer'
import type { ToolId } from '../state/uiStore'

export interface PointerInputOptions {
  canvas: HTMLCanvasElement
  document: SceneDocument
  getCamera: () => Camera
  setCamera: (camera: Camera) => void
  getTool: () => ToolId
  getSelection: () => readonly NodeId[]
  setSelection: (ids: readonly NodeId[]) => void
  toggleInSelection: (id: NodeId) => void
  /** Ask for a redraw. Document edits redraw on their own, camera moves do not. */
  requestDraw: () => void
}

interface DraggedNode {
  id: NodeId
  /** World to parent space, so a world delta becomes the local offset the node stores. */
  parentInverse: Mat2D
  startTransform: Mat2D
  startLocal: Vec2
}

interface Drag {
  pointerId: number
  kind: 'move' | 'pan'
  startScreen: Vec2
  startCamera: Camera
  nodes: DraggedNode[]
  /** Opened on the first move that actually changes something, not on pointer down. */
  grouped: boolean
}

/**
 * Pointer handling, deliberately outside React.
 *
 * A drag produces a document edit per frame. Routing that through component state would put
 * a render between the pointer and the pixels, which is the one thing this architecture is
 * built to avoid. Selection does live in React state, but it changes once per gesture.
 */
export function createPointerInput(options: PointerInputOptions): () => void {
  const { canvas, document } = options
  let drag: Drag | null = null
  let spaceHeld = false

  const viewportOf = (): Viewport => {
    const rect = canvas.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }

  const screenOf = (event: PointerEvent): Vec2 => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const worldOf = (screen: Vec2): Vec2 =>
    screenToWorld(options.getCamera(), viewportOf(), screen)

  const onPointerDown = (event: PointerEvent): void => {
    if (drag) return
    const screen = screenOf(event)
    const world = worldOf(screen)

    // Middle button and held space both mean pan, whatever tool is active. Every canvas
    // application agrees on this and muscle memory is stronger than the toolbar.
    const wantsPan = options.getTool() === 'hand' || spaceHeld || event.button === 1
    if (wantsPan) {
      drag = {
        pointerId: event.pointerId,
        kind: 'pan',
        startScreen: screen,
        startCamera: options.getCamera(),
        nodes: [],
        grouped: false,
      }
      canvas.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 0) return

    const hit = hitTest(document, world)
    if (!hit) {
      options.setSelection([])
      return
    }

    if (event.shiftKey) {
      options.toggleInSelection(hit.id)
      return
    }

    // Clicking inside an existing multi selection keeps it, so a group can be dragged
    // without collapsing to the one node under the cursor.
    const selection = options.getSelection()
    const ids = selection.includes(hit.id) ? selection : [hit.id]
    if (!selection.includes(hit.id)) options.setSelection(ids)

    drag = {
      pointerId: event.pointerId,
      kind: 'move',
      startScreen: screen,
      startCamera: options.getCamera(),
      grouped: false,
      nodes: ids.flatMap((id) => {
        const node = document.getNode(id)
        if (!node || node.locked) return []
        const parentInverse = invert(
          node.parent ? document.worldTransform(node.parent) : IDENTITY_MATRIX,
        )
        return [
          {
            id,
            parentInverse,
            startTransform: { ...node.transform },
            startLocal: applyToPoint(parentInverse, world),
          },
        ]
      }),
    }
    canvas.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const screen = screenOf(event)

    if (drag.kind === 'pan') {
      // Screen pixels to world units. Dragging right moves the camera left.
      const zoom = drag.startCamera.zoom
      options.setCamera({
        ...drag.startCamera,
        x: drag.startCamera.x - (screen.x - drag.startScreen.x) / zoom,
        y: drag.startCamera.y - (screen.y - drag.startScreen.y) / zoom,
      })
      options.requestDraw()
      return
    }

    const world = worldOf(screen)
    const current = drag

    // Nothing to record until the pointer has actually moved. Opening the group here rather
    // than on pointer down means a click that never moves leaves the history untouched.
    const moved = current.nodes.some((dragged) => {
      const local = applyToPoint(dragged.parentInverse, world)
      return local.x !== dragged.startLocal.x || local.y !== dragged.startLocal.y
    })
    if (!moved) return
    if (!current.grouped) {
      current.grouped = true
      document.beginHistoryGroup()
    }

    // One transaction, so moving twenty nodes wakes the panels once rather than twenty times.
    // The group above then folds every frame of the gesture into a single undo step.
    document.transact(() => {
      for (const dragged of current.nodes) {
        const local = applyToPoint(dragged.parentInverse, world)
        document.update(dragged.id, {
          transform: {
            ...dragged.startTransform,
            tx: dragged.startTransform.tx + (local.x - dragged.startLocal.x),
            ty: dragged.startTransform.ty + (local.y - dragged.startLocal.y),
          },
        })
      }
    })
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    if (drag.grouped) document.endHistoryGroup()
    drag = null
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceHeld = true
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceHeld = false
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}

const IDENTITY_MATRIX: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
