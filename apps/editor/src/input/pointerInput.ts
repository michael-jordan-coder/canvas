import {
  angleOf,
  applyToPoint,
  containerAt,
  createEllipse,
  createFrame,
  createRectangle,
  fromHex,
  hitTest,
  invert,
  nodesIn,
  type Mat2D,
  type NodeId,
  type Rect,
  type SceneDocument,
  type SceneNode,
  type Size,
  type Vec2,
} from '@figma-canvas/document'
import {
  grabAt,
  screenToWorld,
  selectionBox,
  selectionWorldBounds,
  type Camera,
  type GrabId,
  type HandleId,
  type Viewport,
} from '@figma-canvas/renderer'
import { duplicateNodes } from '../state/duplicate'
import {
  applyRotation,
  rotateTargetsFor,
  snapDelta,
  worldCentre,
  type RotateTarget,
} from '../state/rotate'
import {
  anchorFor,
  localBox,
  resizedInPlace,
  resizedNode,
  scaleFactors,
  type ResizeTarget,
} from './resize'
import type { ToolId } from '../state/uiStore'

export interface PointerInputOptions {
  canvas: HTMLCanvasElement
  document: SceneDocument
  getCamera: () => Camera
  setCamera: (camera: Camera) => void
  getTool: () => ToolId
  setTool: (tool: ToolId) => void
  getSelection: () => readonly NodeId[]
  setSelection: (ids: readonly NodeId[]) => void
  toggleInSelection: (id: NodeId) => void
  /** The rubber band rectangle in CSS pixels, or null when there is not one. */
  setMarquee: (rect: Rect | null) => void
  /** Ask for a redraw. Document edits redraw on their own, camera moves do not. */
  requestDraw: () => void
}

/** Drawn when a shape tool is clicked rather than dragged. */
const DEFAULT_SHAPE_SIZE = 100

const SHAPE_TOOLS = new Set<ToolId>(['rectangle', 'ellipse', 'frame'])

function createNodeForTool(tool: ToolId): SceneNode | null {
  switch (tool) {
    case 'rectangle':
      return createRectangle({ fills: [fromHex('#c4c4c4')] })
    case 'ellipse':
      return createEllipse({ fills: [fromHex('#c4c4c4')] })
    case 'frame':
      return createFrame({ fills: [fromHex('#ffffff')] })
    default:
      return null
  }
}

/** A rect from two corners, in any drag direction. */
function rectBetween(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

interface DraggedNode {
  id: NodeId
  /** World to parent space, so a world delta becomes the local offset the node stores. */
  parentInverse: Mat2D
  startTransform: Mat2D
  startLocal: Vec2
}

interface ResizedNode extends ResizeTarget {
  id: NodeId
}

/**
 * A single node resizes in its own frame, so dragging its east handle lengthens it along its
 * own x axis however it is turned. Resolved once at grab time: the linear part does not change
 * during a resize, but the translation does, so recomputing this mid gesture would drift.
 */
interface LocalResize {
  id: NodeId
  /** World to the node's own units, as it was when the handle was grabbed. */
  worldInverse: Mat2D
  startTransform: Mat2D
  startSize: Size
}

interface Drag {
  pointerId: number
  kind: 'move' | 'pan' | 'resize' | 'rotate' | 'create' | 'marquee'
  startScreen: Vec2
  startWorld: Vec2
  startCamera: Camera
  nodes: DraggedNode[]
  /** Opened on the first move that actually changes something, not on pointer down. */
  grouped: boolean
  /** Option was held at pointer down, so the first move drags a copy instead. */
  duplicateOnMove: boolean
  /** Resize only: which handle was grabbed, and the box as it was when it was grabbed. */
  handle?: HandleId
  startBounds?: Rect
  resizing?: ResizedNode[]
  /** Set instead of `resizing` when exactly one node is selected. */
  localResize?: LocalResize
  /** Kept so a modifier pressed without moving the pointer can re-apply the resize. */
  lastScreen?: Vec2
  /** Create only: the node once the drag has actually produced one, and its parent. */
  created?: NodeId
  createParent?: NodeId
  createTool?: ToolId
  /** Marquee only: what was selected before it started, kept so shift can extend it. */
  marqueeBase?: readonly NodeId[]
  /** Rotate only: the pivot in world space, the angle the pointer began at, and the targets. */
  pivot?: Vec2
  startAngle?: number
  /** The one node's own angle at grab time, or null for a multiple selection. */
  startNodeAngle?: number | null
  rotating?: RotateTarget[]
}

interface Modifiers {
  /** Anchor to the centre rather than the opposite corner. */
  fromCentre: boolean
  /** Hold the aspect ratio. */
  constrain: boolean
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
        startWorld: world,
        startCamera: options.getCamera(),
        nodes: [],
        grouped: false,
        duplicateOnMove: false,
      }
      canvas.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 0) return

    const tool = options.getTool()
    if (SHAPE_TOOLS.has(tool)) {
      drag = {
        pointerId: event.pointerId,
        kind: 'create',
        startScreen: screen,
        startWorld: world,
        startCamera: options.getCamera(),
        grouped: false,
        duplicateOnMove: false,
        nodes: [],
        createTool: tool,
        // Whatever frame the drag began inside becomes the parent, so the new shape moves
        // with that frame afterwards rather than merely sitting on top of it.
        createParent: containerAt(document, world).id,
      }
      canvas.setPointerCapture(event.pointerId)
      return
    }

    // Handles are tested before the shapes under them, because a handle sits on the very edge
    // of its node and the node would otherwise win every grab.
    const grabbed = tool === 'move' ? grabUnder(screen) : null

    if (grabbed === 'rotate') {
      const ids = options.getSelection()
      const pivot = selectionPivot(ids)
      if (pivot) {
        drag = {
          pointerId: event.pointerId,
          kind: 'rotate',
          startScreen: screen,
          startWorld: world,
          startCamera: options.getCamera(),
          grouped: false,
          duplicateOnMove: false,
          nodes: [],
          pivot,
          startAngle: Math.atan2(world.y - pivot.y, world.x - pivot.x),
          // Only a single selection has an angle to land a snap on.
          startNodeAngle:
            ids.length === 1 && ids[0] ? angleOf(document.worldTransform(ids[0])) : null,
          rotating: rotateTargetsFor(document, ids),
        }
        canvas.setPointerCapture(event.pointerId)
        return
      }
    }

    if (grabbed && grabbed !== 'rotate') {
      const bounds = selectionWorldBounds(document, options.getSelection())
      if (bounds) {
        drag = {
          pointerId: event.pointerId,
          kind: 'resize',
          startScreen: screen,
          startWorld: world,
          startCamera: options.getCamera(),
          grouped: false,
          duplicateOnMove: false,
          nodes: [],
          handle: grabbed,
          startBounds: bounds,
          localResize: localResizeFor(options.getSelection()),
          resizing: options.getSelection().flatMap((id) => {
            const node = document.getNode(id)
            if (!node || node.locked) return []
            return [
              {
                id,
                parentInverse: invert(
                  node.parent ? document.worldTransform(node.parent) : IDENTITY_MATRIX,
                ),
                startTransform: { ...node.transform },
                startSize: { ...node.size },
              },
            ]
          }),
        }
        canvas.setPointerCapture(event.pointerId)
        return
      }
    }

    const hit = hitTest(document, world)
    if (!hit) {
      // Empty canvas: clear, then rubber band. Clearing up front rather than on release is
      // what makes a click on nothing feel immediate.
      const base = event.shiftKey ? options.getSelection() : []
      if (!event.shiftKey) options.setSelection([])
      drag = {
        pointerId: event.pointerId,
        kind: 'marquee',
        startScreen: screen,
        startWorld: world,
        startCamera: options.getCamera(),
        grouped: false,
        duplicateOnMove: false,
        nodes: [],
        marqueeBase: base,
      }
      canvas.setPointerCapture(event.pointerId)
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
      startWorld: world,
      startCamera: options.getCamera(),
      grouped: false,
      // Held at pointer down, acted on at the first move. Option clicking without dragging
      // should not leave a copy behind, which is how Figma behaves.
      duplicateOnMove: event.altKey,
      nodes: draggedNodesFor(ids, world),
    }
    canvas.setPointerCapture(event.pointerId)
  }

  /** What is under a screen point: a resize handle, the rotate handle, or nothing. */
  const grabUnder = (screen: Vec2): GrabId | null => {
    const selection = options.getSelection()
    if (selection.length === 0) return null
    // The drawn box, rotation included, so a handle on a turned node is grabbed where it
    // actually sits rather than where an upright box would have put it.
    const box = selectionBox(document, selection, options.getCamera(), viewportOf())
    return box ? grabAt(box, screen) : null
  }

  /**
   * The node to resize in its own frame, if the selection is exactly one.
   *
   * More than one has no shared basis to resize along, so the selection box is upright and so
   * is the resize. That is the same rule `selectionBox` follows, which is what keeps the box
   * you drag and the maths behind it agreeing.
   */
  const localResizeFor = (ids: readonly NodeId[]): LocalResize | undefined => {
    if (ids.length !== 1) return undefined
    const id = ids[0]
    if (!id) return undefined
    const node = document.getNode(id)
    if (!node || node.locked) return undefined
    return {
      id,
      worldInverse: invert(document.worldTransform(id)),
      startTransform: { ...node.transform },
      startSize: { ...node.size },
    }
  }

  /**
   * The point a rotation turns about.
   *
   * The centre of the one node when there is one, so it turns in place, and the centre of the
   * selection's bounds otherwise, so a group swings together rather than each part spinning
   * on its own spot.
   */
  const selectionPivot = (ids: readonly NodeId[]): Vec2 | null => {
    if (ids.length === 1 && ids[0]) return worldCentre(document, ids[0])
    const bounds = selectionWorldBounds(document, ids)
    return bounds
      ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      : null
  }

  /** Everything needed to move a set of nodes with the pointer, resolved once at grab time. */
  const draggedNodesFor = (ids: readonly NodeId[], world: Vec2): DraggedNode[] =>
    ids.flatMap((id) => {
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
    })

  const onPointerMove = (event: PointerEvent): void => {
    const screen = screenOf(event)

    if (!drag) {
      // Not dragging, so this is only about what the cursor should look like. The value goes
      // on a data attribute rather than into style, so the cursors stay in the stylesheet.
      const hovered = options.getTool() === 'move' ? grabUnder(screen) : null
      if (hovered) canvas.dataset['handle'] = hovered
      else delete canvas.dataset['handle']
      return
    }

    if (event.pointerId !== drag.pointerId) return

    if (drag.kind === 'resize') {
      applyResize(drag, screen, { fromCentre: event.altKey, constrain: event.shiftKey })
      return
    }

    if (drag.kind === 'rotate') {
      applyRotate(drag, screen, { fromCentre: event.altKey, constrain: event.shiftKey })
      return
    }

    if (drag.kind === 'create') {
      applyCreate(drag, screen, { fromCentre: event.altKey, constrain: event.shiftKey })
      return
    }

    if (drag.kind === 'marquee') {
      options.setMarquee(rectBetween(drag.startScreen, screen))

      const caught = nodesIn(document, rectBetween(drag.startWorld, worldOf(screen))).map(
        (node) => node.id,
      )
      // Shift extends whatever was already selected, matching shift clicking.
      const base = drag.marqueeBase ?? []
      const next = [...base, ...caught.filter((id) => !base.includes(id))]

      // Only when it actually differs. Selection lives in React state, and writing it on
      // every frame of the rubber band would re-render the layers tree sixty times a second
      // to arrive at the same list.
      const current = options.getSelection()
      const changed =
        next.length !== current.length || next.some((id, index) => id !== current[index])
      if (changed) options.setSelection(next)

      options.requestDraw()
      return
    }

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
      // Opened before the duplicate, so the copy and every frame of the drag that follows
      // collapse into one step. Undoing an option drag removes the copy outright.
      document.beginHistoryGroup()

      if (current.duplicateOnMove) {
        current.duplicateOnMove = false
        // Zero offset: the copy starts exactly on the original and this gesture moves it.
        const copies = duplicateNodes(
          document,
          current.nodes.map((dragged) => dragged.id),
          { x: 0, y: 0 },
        )
        if (copies.length > 0) {
          const copyIds = copies.map((copy) => copy.id)
          options.setSelection(copyIds)
          // Rebuilt rather than remapped, because a selection containing a frame and one of
          // its own children collapses to fewer roots than it had ids.
          current.nodes = draggedNodesFor(copyIds, current.startWorld)
        }
      }
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

  const applyResize = (current: Drag, screen: Vec2, modifiers: Modifiers): void => {
    const { handle, startBounds, resizing, localResize } = current
    if (!handle || !startBounds || !resizing || resizing.length === 0) return

    current.lastScreen = screen
    const pointer = worldOf(screen)

    if (localResize) {
      // Everything in the node's own units: the box is at the origin, the anchor is a corner
      // of it, and the pointer is mapped in. The functions below are the same ones the world
      // aligned path uses, handed a different frame.
      const box = localBox(localResize.startSize)
      const anchor = anchorFor(handle, box, modifiers.fromCentre)
      const local = applyToPoint(localResize.worldInverse, pointer)
      const { sx, sy } = scaleFactors(box, handle, anchor, local, {
        constrain: modifiers.constrain,
      })

      if (!current.grouped) {
        current.grouped = true
        document.beginHistoryGroup()
      }

      const { transform, size } = resizedInPlace(localResize, anchor, sx, sy)
      document.update(localResize.id, { transform, size })
      return
    }

    // Recomputed every time rather than at grab time, so alt can be pressed or released
    // partway through a resize and the anchor follows.
    const anchor = anchorFor(handle, startBounds, modifiers.fromCentre)
    const { sx, sy } = scaleFactors(startBounds, handle, anchor, pointer, {
      constrain: modifiers.constrain,
    })

    if (!current.grouped) {
      current.grouped = true
      document.beginHistoryGroup()
    }

    document.transact(() => {
      for (const target of resizing) {
        // The anchor is shared in world space, but each node is written in its parent's, so
        // it is mapped across per node. The factors themselves need no conversion.
        const anchorInParent = applyToPoint(target.parentInverse, anchor)
        const { transform, size } = resizedNode(target, anchorInParent, sx, sy)
        document.update(target.id, { transform, size })
      }
    })
  }

  /**
   * Turns the selection to follow the pointer around the pivot.
   *
   * The angle is measured from the pivot to the pointer and compared with where it was when
   * the handle was grabbed, so the shape does not jump on the first move: what matters is how
   * far the pointer has travelled around, not where on the handle it landed.
   */
  const applyRotate = (current: Drag, screen: Vec2, modifiers: Modifiers): void => {
    const { pivot, rotating, startAngle } = current
    if (!pivot || !rotating || rotating.length === 0 || startAngle === undefined) return

    current.lastScreen = screen
    const pointer = worldOf(screen)
    const now = Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x)
    const raw = now - startAngle
    const delta = modifiers.constrain
      ? snapDelta(raw, current.startNodeAngle ?? null)
      : raw

    if (!current.grouped) {
      current.grouped = true
      document.beginHistoryGroup()
    }

    applyRotation(document, rotating, delta, pivot)
  }

  /**
   * Draws the new shape live as the pointer moves.
   *
   * The node is created on the first move rather than on pointer down, so a click that turns
   * out to be a click and not a drag can take the default size path instead of leaving a
   * zero sized node behind for a frame.
   */
  const applyCreate = (current: Drag, screen: Vec2, modifiers: Modifiers): void => {
    const tool = current.createTool
    const parentId = current.createParent
    if (!tool || !parentId) return

    const pointer = worldOf(screen)
    let box = rectBetween(current.startWorld, pointer)
    if (modifiers.constrain) {
      const side = Math.max(box.width, box.height)
      box = { ...box, width: side, height: side }
    }
    if (modifiers.fromCentre) {
      // The start point becomes the centre rather than a corner.
      const halfWidth = Math.abs(pointer.x - current.startWorld.x)
      const halfHeight = Math.abs(pointer.y - current.startWorld.y)
      const side = modifiers.constrain ? Math.max(halfWidth, halfHeight) : 0
      const width = modifiers.constrain ? side * 2 : halfWidth * 2
      const height = modifiers.constrain ? side * 2 : halfHeight * 2
      box = {
        x: current.startWorld.x - width / 2,
        y: current.startWorld.y - height / 2,
        width,
        height,
      }
    }

    if (!current.grouped) {
      current.grouped = true
      document.beginHistoryGroup()
    }

    // Positions are stored in the parent's space, so a shape drawn inside a scaled frame
    // lands under the cursor rather than somewhere proportionally off.
    const toParent = invert(document.worldTransform(parentId))
    const origin = applyToPoint(toParent, { x: box.x, y: box.y })
    const far = applyToPoint(toParent, { x: box.x + box.width, y: box.y + box.height })
    const size = { width: Math.abs(far.x - origin.x), height: Math.abs(far.y - origin.y) }

    if (!current.created) {
      const node = createNodeForTool(tool)
      if (!node) return
      document.insert(node, parentId)
      current.created = node.id
      options.setSelection([node.id])
    }

    document.update(current.created, {
      transform: { ...IDENTITY_MATRIX, tx: origin.x, ty: origin.y },
      size,
    })
  }

  /** A click with a shape tool, rather than a drag, drops a default sized node there. */
  const createAtPoint = (current: Drag): void => {
    const tool = current.createTool
    const parentId = current.createParent
    if (!tool || !parentId) return

    const node = createNodeForTool(tool)
    if (!node) return

    const toParent = invert(document.worldTransform(parentId))
    const origin = applyToPoint(toParent, current.startWorld)

    document.transact(() => {
      document.insert(node, parentId)
      document.update(node.id, {
        transform: { ...IDENTITY_MATRIX, tx: origin.x, ty: origin.y },
        size: { width: DEFAULT_SHAPE_SIZE, height: DEFAULT_SHAPE_SIZE },
      })
      options.setSelection([node.id])
    })
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

    if (drag.kind === 'create') {
      // Never moved, so it was a click. One default sized shape at the click point.
      if (!drag.created) createAtPoint(drag)
      if (drag.grouped) document.endHistoryGroup()
      // Back to move, the way Figma's tools are one shot rather than modal. Without this,
      // the very next click draws a second shape instead of selecting the first.
      options.setTool('move')
      drag = null
      return
    }

    if (drag.kind === 'marquee') {
      options.setMarquee(null)
      options.requestDraw()
      drag = null
      return
    }

    // A node dropped over a different frame joins it. Done on release rather than during the
    // drag, so the tree does not churn while the pointer passes over things on its way.
    if (drag.kind === 'move' && drag.grouped) {
      const target = containerAt(document, worldOf(screenOf(event)))
      document.transact(() => {
        for (const dragged of drag?.nodes ?? []) {
          const node = document.getNode(dragged.id)
          // reparent already refuses a node's own descendant, so a frame dropped onto itself
          // simply stays where it is.
          if (node && node.parent !== target.id) document.reparent(dragged.id, target.id)
        }
      })
    }

    if (drag.grouped) document.endHistoryGroup()
    drag = null
  }

  /**
   * A modifier pressed or released mid resize has to take effect at once.
   *
   * Without this, holding shift changes nothing until the pointer moves again, which reads
   * as the shortcut being broken rather than merely late.
   */
  const reapplyModifiers = (event: KeyboardEvent): void => {
    if (!drag || !drag.lastScreen) return
    if (event.key !== 'Alt' && event.key !== 'Shift') return
    const modifiers = { fromCentre: event.altKey, constrain: event.shiftKey }
    if (drag.kind === 'resize') applyResize(drag, drag.lastScreen, modifiers)
    if (drag.kind === 'rotate') applyRotate(drag, drag.lastScreen, modifiers)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceHeld = true
    reapplyModifiers(event)
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceHeld = false
    reapplyModifiers(event)
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
