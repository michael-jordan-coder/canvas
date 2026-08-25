import {
  angleOf,
  applyToPoint,
  containerAt,
  createEllipse,
  createFrame,
  createRectangle,
  createText,
  caretAtPoint,
  fromHex,
  hitTest,
  insertionIndex,
  invert,
  isAutoLayoutFrame,
  containsPoint,
  nodesIn,
  type FrameLayout,
  type LayoutChild,
  type Mat2D,
  type NodeId,
  type Rect,
  type SceneDocument,
  type FontMetrics,
  type SceneNode,
  type Size,
  type TextLayoutCache,
  type TextNode,
  type Vec2,
} from '@canvas/document'
import {
  grabAt,
  resizeHandlesFor,
  screenToWorld,
  selectionBox,
  selectionWorldBounds,
  type Camera,
  type GrabId,
  type HandleId,
  type Viewport,
} from '@canvas/renderer'
import { relayout } from '../state/autoLayout'
import {
  endPlay,
  playGeneration,
  playHitAt,
  playTargetAt,
  rerunCodeNodesIn,
  sendPlayEvent,
} from '../state/code'
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
  axesFor,
  localBox,
  resizedInPlace,
  resizedNode,
  scaleFactors,
  type ResizeTarget,
} from './resize'
import type { ToolId } from '../state/uiStore'
import {
  deepSelectionTarget,
  descendSelectionTarget,
  selectionTarget,
  type SelectionContext,
} from '../state/selectionTarget'
import { isEditingText } from './isEditingText'

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
  getContext: () => SelectionContext
  setContext: (context: SelectionContext) => void
  setHover: (id: NodeId | null) => void
  /** The rubber band rectangle in CSS pixels, or null when there is not one. */
  setMarquee: (rect: Rect | null) => void
  /** Ask for a redraw. Document edits redraw on their own, camera moves do not. */
  requestDraw: () => void
  /** Open the inline editor on a text node, placing the caret at an offset. */
  beginTextEdit: (id: NodeId, caret: number, anchor?: number) => void
  /** Extend the current text selection to an offset, while dragging inside the text. */
  setTextCaret: (caret: number, anchor: number) => void
  /** Commit whatever is being typed, because the pointer went somewhere else. */
  endTextEdit: () => void
  /** The node being typed into, or null. */
  getEditing: () => { id: NodeId; anchor: number } | null
  /**
   * The font, or null until it has loaded. Handed over whole rather than as a measure
   * callback, because placing a caret needs the layout and not only its bounds.
   */
  getMetrics: () => FontMetrics | null
  /** Where laid out text is kept. Shared, so a click lands in the layout that was drawn. */
  layouts: TextLayoutCache
  /** Changes a text node and rewrites its cached bounds with it, in one step. */
  updateText: (node: TextNode, changes: Partial<TextNode>) => void
  /** The code node whose prototype is running, or null. Pointer events go to it first. */
  getPlay: () => NodeId | null
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
  /**
   * Where the gesture found the node, for Escape to put it back. Separate from the fields
   * above because a live reparent mid drag rebases those against the new parent, while a
   * cancel has to reach past every rebase to the true beginning.
   */
  origin: { parent: NodeId | null; index: number; transform: Mat2D }
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
  /**
   * Dragging a handle can flip a hug axis or a fill axis to fixed, so a cancel has to be
   * able to flip them back. Captured whole rather than as flags, for the same reason the
   * transform is.
   */
  startLayout?: FrameLayout
  startLayoutChild?: LayoutChild
}

interface Drag {
  pointerId: number
  kind: 'move' | 'pan' | 'resize' | 'rotate' | 'create' | 'marquee' | 'text'
  startScreen: Vec2
  startWorld: Vec2
  startCamera: Camera
  nodes: DraggedNode[]
  /** Opened on the first move that actually changes something, not on pointer down. */
  grouped: boolean
  /** Option was held at pointer down, so the first move drags a copy instead. */
  duplicateOnMove: boolean
  /**
   * Set once `duplicateOnMove` has fired, to the nodes the copies were made from. Tells a
   * cancel that `nodes` are copies to delete rather than originals to restore, and gives it
   * the selection to put back.
   */
  duplicatedFrom?: readonly NodeId[]
  /**
   * Create only: what was selected before the gesture. Creating selects the new node as it
   * draws, so cancelling has to put the previous selection back rather than leave it pointing
   * at a node it just removed.
   */
  startSelection?: readonly NodeId[]
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
  /**
   * Move only: the auto layout frame currently holding a slot open for the dragged node.
   * While set, the node floats with the pointer, every layout pass excludes it, and the
   * release is what snaps it into the slot.
   */
  reorderFrame?: NodeId
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
  // Kept so a Space press or release can update the pan cursor immediately, without waiting
  // for the pointer to move first.
  let lastPointerScreen: Vec2 | null = null
  // Play mode's pointer bookkeeping: the element the press landed on, so the release can
  // decide whether the pair was a click, and the element under the pointer, so a crossing
  // sends one leave and one enter rather than a stream of either.
  let playPress: { element: string | null } | null = null
  let playHover: string | null = null
  // Which play session the hover above belongs to. A session ends in four places and only
  // one of them is here, so rather than clearing the hover from each, it is compared: an id
  // recorded under an older session is not a pointer still resting on that element, and the
  // enter it is owed has to be sent again.
  let playHoverAt = -1

  const viewportOf = (): Viewport => {
    const rect = canvas.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }

  /** Enter and leave, from diffing the element under the pointer against the last move. */
  const routePlayHover = (playing: NodeId, world: Vec2): void => {
    const hit = playHitAt(playing, world)
    const element = hit?.elementId ?? null
    const generation = playGeneration()
    const previous = playHoverAt === generation ? playHover : null
    if (element !== previous) {
      const point = hit?.point ?? { x: 0, y: 0 }
      if (previous !== null) {
        const leaveTarget = playTargetAt(playing, previous, 'pointerLeave')
        if (leaveTarget) sendPlayEvent(playing, leaveTarget, 'pointerLeave', point)
      }
      if (element !== null) {
        const enterTarget = playTargetAt(playing, element, 'pointerEnter')
        if (enterTarget && hit) sendPlayEvent(playing, enterTarget, 'pointerEnter', hit.point)
      }
      playHover = element
      playHoverAt = generation
    }
    // The editor's own affordances stand down while the prototype has the pointer.
    options.setHover(null)
    delete canvas.dataset['handle']
    delete canvas.dataset['pan']
  }

  const screenOf = (event: PointerEvent): Vec2 => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const worldOf = (screen: Vec2): Vec2 =>
    screenToWorld(options.getCamera(), viewportOf(), screen)


  /*
   * Tracked by hand rather than read off the event. `PointerEvent.detail` is specified as 0
   * for pointerdown, so the platform's click count is only ever on click and dblclick, and
   * this layer listens to neither: it needs the count at pointer down, before a gesture can
   * begin, not after one has finished.
   */
  const DOUBLE_CLICK_MS = 400
  const DOUBLE_CLICK_SLOP = 4
  let lastClickAt = 0
  let lastClickScreen: Vec2 | null = null

  /**
   * How far the pointer has to travel before a press counts as a drag, in CSS pixels.
   *
   * Without it any press is a drag, because the test for "has this moved" can only be exact:
   * half a pixel of tremor between pointer down and the first move is a real difference. What
   * that costs is not one wasted history step. A gesture that has begun pulls its node out of
   * the auto layout flow so it can float, which is right once the node has visibly detached
   * and wrong while it is still sitting where it was: the siblings close up over it and stay
   * that way for as long as the button is held. Clearing the slop is what makes the reflow
   * follow a movement the eye has already seen.
   *
   * The same number as the double click slop, and for the same underlying reason: below a few
   * pixels a pointer has not gone anywhere on purpose. They stay separate constants because
   * they answer different questions and either could move without the other.
   */
  const DRAG_SLOP = 4

  /**
   * Whether a gesture has earned the right to act yet.
   *
   * `grouped` latches it: once past the slop a drag stays one, so coming back inside it does
   * not suspend the gesture halfway through.
   */
  const clearedSlop = (current: Drag, screen: Vec2): boolean =>
    current.grouped ||
    Math.abs(screen.x - current.startScreen.x) > DRAG_SLOP ||
    Math.abs(screen.y - current.startScreen.y) > DRAG_SLOP

  const isDoubleClick = (screen: Vec2, now: number): boolean => {
    if (!lastClickScreen || now - lastClickAt > DOUBLE_CLICK_MS) return false
    return (
      Math.abs(screen.x - lastClickScreen.x) <= DOUBLE_CLICK_SLOP &&
      Math.abs(screen.y - lastClickScreen.y) <= DOUBLE_CLICK_SLOP
    )
  }

  /** The offset in a text node nearest a world point, or null if the point misses it. */
  const caretIn = (id: NodeId, world: Vec2, clamp = false): number | null => {
    const node = document.getNode(id)
    const metrics = options.getMetrics()
    if (!node || node.type !== 'text' || !metrics) return null

    const local = applyToPoint(invert(document.worldTransform(id)), world)
    const layout = options.layouts.layoutFor(node, metrics)
    // A sweep that leaves the box keeps selecting to the nearest offset, the way dragging
    // out of a text field does. A fresh click outside it has to miss, so it can commit.
    // The same test the click that selects a node uses, so "inside the node I am editing"
    // cannot drift from "inside the node". On a fixed width box those are different numbers:
    // the layout is as wide as the ink, the node is as wide as the text wraps to.
    if (!clamp && !containsPoint(node, local)) return null
    return caretAtPoint(layout, local)
  }

  /**
   * Drops an empty text node at the point and opens it for typing.
   *
   * Empty, and with no size, so it is unclickable and invisible until a character is typed.
   * That is what lets a click that types nothing be discarded on commit with no special
   * case, exactly the way a zero sized shape never reaches the document at all.
   */
  const createTextAt = (world: Vec2): void => {
    const parentId = containerAt(document, world).id
    const toParent = invert(document.worldTransform(parentId))
    const origin = applyToPoint(toParent, world)
    const node = createText({ fills: [fromHex('#1a1a1a')] })

    document.transact(() => {
      document.insert(node, parentId)
      document.update<TextNode>(node.id, {
        transform: { ...IDENTITY_MATRIX, tx: origin.x, ty: origin.y },
      })
      relayout(document, [node.id])
      options.setSelection([node.id])
    })

    // Back to move first. Switching tools ends any edit, so opening the editor afterwards is
    // the only order that leaves it open.
    options.setTool('move')
    options.beginTextEdit(node.id, 0)
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (drag) return
    const screen = screenOf(event)
    const world = worldOf(screen)
    lastPointerScreen = screen

    // The press is the answer to the question the outline was asking, so it stops asking.
    // Whatever this turns into, the release ends by recomputing the cursor and with it the
    // outline, which is what brings it back around a node that is still under the pointer.
    options.setHover(null)

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
      canvas.dataset['pan'] = 'grabbing'
      return
    }

    if (event.button !== 0) return

    /*
     * A running prototype owns the clicks inside it: the press goes to the code, not to
     * selection, which is exactly the difference between play and edit. A press outside the
     * playing node is the exit gesture, and it stays a click, so whatever it landed on gets
     * selected the moment play ends.
     */
    const playing = options.getPlay()
    if (playing !== null) {
      const playHit = playHitAt(playing, world)
      if (playHit) {
        playPress = { element: playHit.elementId }
        const target = playHit.elementId
          ? playTargetAt(playing, playHit.elementId, 'pointerDown')
          : null
        if (target) sendPlayEvent(playing, target, 'pointerDown', playHit.point)
        return
      }
      endPlay()
    }

    const tool = options.getTool()

    /*
     * A pointer down while typing either moves the caret, if it lands in the node being
     * typed into, or commits and carries on as an ordinary click everywhere else. Clicking
     * away to commit is the same gesture as clicking away to deselect, so it must not also
     * swallow the click.
     */
    const editing = options.getEditing()
    if (editing) {
      const caret = caretIn(editing.id, world)
      if (caret !== null) {
        // Clicking a canvas moves focus to the body, which would blur the field collecting
        // the keystrokes a moment after it was focused. Nothing here wants the default.
        event.preventDefault()
        const anchor = event.shiftKey ? editing.anchor : caret
        options.setTextCaret(caret, anchor)
        drag = {
          pointerId: event.pointerId,
          kind: 'text',
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
      options.endTextEdit()
    }

    if (tool === 'text') {
      // See above: the click must not take focus off the field that is about to receive it.
      event.preventDefault()
      // A click and a drag mean the same thing while the box is auto width, so there is no
      // create gesture to run and nothing to do on the way up.
      createTextAt(world)
      lastClickAt = event.timeStamp
      lastClickScreen = screen
      return
    }

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
        startSelection: options.getSelection(),
        // Whatever frame the drag began inside becomes the parent, so the new shape moves
        // with that frame afterwards rather than merely sitting on top of it.
        createParent: containerAt(document, world).id,
      }
      canvas.setPointerCapture(event.pointerId)
      return
    }

    const doubled = isDoubleClick(screen, event.timeStamp)
    lastClickAt = event.timeStamp
    lastClickScreen = screen

    if (tool === 'move' && doubled) {
      const hit = hitTest(document, world)
      if (hit) {
        // One level in per double click. Only when there is nothing left to descend into
        // does a double click mean the other thing it means, which is opening text to type.
        const deeper = descendSelectionTarget(document, hit.id, options.getContext())
        if (deeper) {
          event.preventDefault()
          options.setSelection([deeper.id])
          options.setContext(deeper.context)
          return
        }
        if (hit.type === 'text') {
          event.preventDefault()
          const caret = caretIn(hit.id, world, true) ?? 0
          options.beginTextEdit(hit.id, caret)
          return
        }
      }
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
      if (!event.shiftKey) {
        options.setSelection([])
        // Clicking past everything is how someone leaves the frame they were working in.
        options.setContext(null)
      }
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

    // What the pointer landed on is a geometry answer; what it selects is a policy, and the
    // policy is the hierarchy. Cmd is the way past it, straight to the deepest node, and it
    // takes the context down with it so the clicks after it stay at that level.
    const resolved = event.metaKey || event.ctrlKey
      ? deepSelectionTarget(document, hit.id)
      : selectionTarget(document, hit.id, options.getContext())

    if (event.shiftKey) {
      options.toggleInSelection(resolved.id)
      return
    }

    options.setContext(resolved.context)

    // Clicking inside an existing multi selection keeps it, so a group can be dragged
    // without collapsing to the one node under the cursor.
    const selection = options.getSelection()
    const ids = selection.includes(resolved.id) ? selection : [resolved.id]
    if (!selection.includes(resolved.id)) options.setSelection(ids)

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
    if (!box) return null
    // The same set the overlay draws, so a handle that is not there cannot be grabbed.
    return grabAt(box, screen, resizeHandlesFor(document, selection))
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
      startLayout:
        node.type === 'frame' && node.layout
          ? { ...node.layout, padding: { ...node.layout.padding } }
          : undefined,
      startLayoutChild: node.layoutChild ? { ...node.layoutChild } : undefined,
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
          origin: {
            parent: node.parent,
            index: document.indexOf(id),
            transform: { ...node.transform },
          },
        },
      ]
    })

  /**
   * The same node re-anchored against its parent of the moment, after a live reparent.
   *
   * The pointer's world offset from the node is unchanged, so recapturing both sides of the
   * subtraction at the same instant keeps the node exactly where it was under the cursor.
   * `origin` is deliberately carried over untouched: it is the cancel's, not the drag's.
   */
  const rebasedNode = (dragged: DraggedNode, world: Vec2): DraggedNode => {
    const node = document.expectNode(dragged.id)
    const parentInverse = invert(
      node.parent ? document.worldTransform(node.parent) : IDENTITY_MATRIX,
    )
    return {
      ...dragged,
      parentInverse,
      startTransform: { ...node.transform },
      startLocal: applyToPoint(parentInverse, world),
    }
  }

  /**
   * What a click at this point would select, or null for nothing.
   *
   * Resolved through the same policy the click itself uses, Cmd included, because the whole
   * job of the outline is to say what is about to happen. One that named the deepest node
   * while the click selected its frame would be worse than no outline at all.
   */
  const hoverTargetAt = (screen: Vec2, deep: boolean): NodeId | null => {
    const hit = hitTest(document, worldOf(screen))
    if (!hit) return null
    return deep
      ? deepSelectionTarget(document, hit.id).id
      : selectionTarget(document, hit.id, options.getContext()).id
  }

  /**
   * Not dragging, so this is only about what the pointer is telling you. The cursor goes on a
   * data attribute rather than into style, so the cursors stay in the stylesheet. A pan cursor
   * takes priority over a resize/rotate handle: holding space to pan means exactly that,
   * whatever happens to be under the pointer.
   *
   * The hover outline is decided here too, and it is off whenever the cursor is not the move
   * tool's arrow: a hand about to pan and a tool about to draw are both saying the next press
   * is not a selection, so outlining what it would have selected would contradict them.
   */
  const updateIdleCursor = (screen: Vec2, deep = false): void => {
    const wantsPan = options.getTool() === 'hand' || spaceHeld
    if (wantsPan) {
      canvas.dataset['pan'] = 'grab'
      delete canvas.dataset['handle']
      options.setHover(null)
      return
    }
    delete canvas.dataset['pan']
    const grabbed = options.getTool() === 'move' ? grabUnder(screen) : null
    if (grabbed) canvas.dataset['handle'] = grabbed
    else delete canvas.dataset['handle']

    // A handle under the pointer means the next press resizes or rotates what is already
    // selected, so there is nothing to preview and the outline would sit on top of the
    // selection's own.
    options.setHover(
      options.getTool() === 'move' && !grabbed ? hoverTargetAt(screen, deep) : null,
    )
  }

  const onPointerMove = (event: PointerEvent): void => {
    const screen = screenOf(event)
    lastPointerScreen = screen

    if (!drag) {
      const playing = options.getPlay()
      if (playing !== null && !spaceHeld && options.getTool() !== 'hand') {
        routePlayHover(playing, worldOf(screen))
        return
      }
      updateIdleCursor(screen, event.metaKey || event.ctrlKey)
      return
    }

    if (event.pointerId !== drag.pointerId) return

    if (drag.kind === 'resize') {
      // Same slop, same reason: a press on a handle that never went anywhere must not flip a
      // hug axis to fixed, which is a claim the gesture makes on its first applied frame.
      if (!clearedSlop(drag, screen)) return
      applyResize(drag, screen, { fromCentre: event.altKey, constrain: event.shiftKey })
      return
    }

    if (drag.kind === 'rotate') {
      if (!clearedSlop(drag, screen)) return
      applyRotate(drag, screen, { fromCentre: event.altKey, constrain: event.shiftKey })
      return
    }

    if (drag.kind === 'create') {
      applyCreate(drag, screen, { fromCentre: event.altKey, constrain: event.shiftKey })
      return
    }

    if (drag.kind === 'text') {
      // The session holds the node and the anchor, and a sweep changes neither.
      const editing = options.getEditing()
      if (!editing) return
      const caret = caretIn(editing.id, worldOf(screen), true)
      if (caret !== null) options.setTextCaret(caret, editing.anchor)
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

    // Nothing to record until the press has become a drag. Opening the group here rather than
    // on pointer down means a click leaves the history untouched, and the slop is what decides
    // when a press has become one.
    if (current.nodes.length === 0) return
    if (!clearedSlop(current, screen)) return
    if (!current.grouped) {
      current.grouped = true
      // Opened before the duplicate, so the copy and every frame of the drag that follows
      // collapse into one step. Undoing an option drag removes the copy outright.
      document.beginHistoryGroup()

      if (current.duplicateOnMove) {
        current.duplicateOnMove = false
        const originals = current.nodes.map((dragged) => dragged.id)
        // Zero offset: the copy starts exactly on the original and this gesture moves it.
        const copies = duplicateNodes(document, originals, { x: 0, y: 0 })
        if (copies.length > 0) {
          const copyIds = copies.map((copy) => copy.id)
          rerunCodeNodesIn(copyIds)
          options.setSelection(copyIds)
          current.duplicatedFrom = originals
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

    applyFlow(current, world)
  }

  /**
   * Keeps a single dragged node honest against auto layout while it moves.
   *
   * Entering an auto layout frame parents the node there at once and opens a slot at the
   * pointer; moving along the frame slides the slot; leaving hands the node to whatever is
   * under the pointer, so the flow closes behind it. Every layout pass excludes the dragged
   * node, which is what lets it float with the pointer while only the siblings shift; the
   * release runs one pass without the exclusion and that is what snaps it in.
   *
   * A multiple selection has no single slot to hold open, so it keeps the drop-on-release
   * path untouched.
   */
  const applyFlow = (current: Drag, world: Vec2): void => {
    if (current.nodes.length !== 1) return
    const dragged = current.nodes[0]
    if (!dragged) return
    const node = document.getNode(dragged.id)
    if (!node) return

    const exclude = new Set([dragged.id])
    const target = containerAt(document, world, exclude)
    if (document.isAncestorOf(dragged.id, target.id)) return

    if (isAutoLayoutFrame(document.getNode(target.id))) {
      const previous = node.parent
      document.transact(() => {
        if (node.parent !== target.id) {
          document.reparent(dragged.id, target.id)
          current.nodes = [rebasedNode(dragged, world)]
        }
        const local = applyToPoint(invert(document.worldTransform(target.id)), world)
        const slot = insertionIndex(document, target.id, local, exclude)
        if (document.indexOf(dragged.id) !== slot) document.reorder(dragged.id, slot)
        relayout(
          document,
          previous && previous !== target.id ? [dragged.id, previous] : [dragged.id],
          exclude,
        )
      })
      current.reorderFrame = target.id
      return
    }

    if (current.reorderFrame) {
      const previous = node.parent
      document.transact(() => {
        if (node.parent !== target.id) {
          document.reparent(dragged.id, target.id)
          current.nodes = [rebasedNode(dragged, world)]
        }
        if (previous) relayout(document, [previous], exclude)
      })
      current.reorderFrame = undefined
    }
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
      const node = document.getNode(localResize.id)

      if (node?.type === 'text') {
        /*
         * Dragging a text node's edge is what turns it into a fixed width box. The width is
         * the handle's to set from here on, because it is the width the lines wrap to. The
         * height is not: it is however many lines that produces. Only the side handles are
         * offered, so the drag never asks for a height in the first place, and the box grows
         * downward from an origin the drag has not moved.
         */
        // measureTextNode on a fixed width node keeps the width it is given and measures
        // only the height, which is exactly the split this needs.
        options.updateText(node, { transform, autoWidth: false, size })
        return
      }

      document.transact(() => {
        document.update(localResize.id, { transform, size, ...flowOverrides(node, handle) })
        // A resized child reflows its siblings; a resized auto frame re-places its children.
        relayout(document, [localResize.id])
      })
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
      relayout(document, resizing.map((target) => target.id))
    })
  }

  /**
   * Dragging a handle claims the axes it moves.
   *
   * On an auto layout frame a dragged hug axis becomes fixed, the frame's mirror of a text
   * box losing `autoWidth` to the same gesture. On a child of one a dragged fill axis
   * becomes fixed, because a hand set size and a computed one cannot both hold. Folded into
   * the same update as the size, so one gesture is one step.
   */
  const flowOverrides = (
    node: SceneNode | undefined,
    handle: HandleId,
  ): { layout?: FrameLayout; layoutChild?: LayoutChild } => {
    if (!node) return {}
    const axes = axesFor(handle)
    const result: { layout?: FrameLayout; layoutChild?: LayoutChild } = {}

    if (isAutoLayoutFrame(node)) {
      const layout = node.layout
      const horizontal = layout.direction === 'horizontal'
      const dragsMain = horizontal ? axes.x : axes.y
      const dragsCross = horizontal ? axes.y : axes.x
      const mainSizing = dragsMain && layout.mainSizing === 'hug' ? 'fixed' : layout.mainSizing
      const crossSizing = dragsCross && layout.crossSizing === 'hug' ? 'fixed' : layout.crossSizing
      if (mainSizing !== layout.mainSizing || crossSizing !== layout.crossSizing) {
        result.layout = { ...layout, padding: { ...layout.padding }, mainSizing, crossSizing }
      }
    }

    const parent = node.parent ? document.getNode(node.parent) : undefined
    if (isAutoLayoutFrame(parent) && node.layoutChild) {
      const widthMode =
        axes.x && node.layoutChild.widthMode === 'fill' ? 'fixed' : node.layoutChild.widthMode
      const heightMode =
        axes.y && node.layoutChild.heightMode === 'fill' ? 'fixed' : node.layoutChild.heightMode
      if (widthMode !== node.layoutChild.widthMode || heightMode !== node.layoutChild.heightMode) {
        result.layoutChild = { widthMode, heightMode }
      }
    }

    return result
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
      relayout(document, [node.id])
      options.setSelection([node.id])
    })
  }

  const onPointerUp = (event: PointerEvent): void => {
    /*
     * The other half of a play press. `click` fires only when the release lands on the
     * element the press did, which is the browser's own reading of what a click is; a drag
     * off the button and back out is two pointer events and no click.
     */
    if (playPress !== null && !drag) {
      const playing = options.getPlay()
      const pressed = playPress
      playPress = null
      if (playing !== null) {
        const hit = playHitAt(playing, worldOf(screenOf(event)))
        if (hit) {
          const upTarget = hit.elementId
            ? playTargetAt(playing, hit.elementId, 'pointerUp')
            : null
          if (upTarget) sendPlayEvent(playing, upTarget, 'pointerUp', hit.point)
          if (hit.elementId !== null && hit.elementId === pressed.element) {
            const clickTarget = playTargetAt(playing, hit.elementId, 'click')
            if (clickTarget) sendPlayEvent(playing, clickTarget, 'click', hit.point)
          }
        }
      }
      return
    }
    if (!drag || event.pointerId !== drag.pointerId) return
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

    if (drag.kind === 'create') {
      // Never moved, so it was a click. One default sized shape at the click point.
      if (!drag.created) createAtPoint(drag)
      // Deferred from the draw itself: a shape being dragged out inside an auto frame would
      // otherwise fight the layout for its own corner on every frame.
      else relayout(document, [drag.created])
      if (drag.grouped) document.endHistoryGroup()
      // Back to move, the way Figma's tools are one shot rather than modal. Without this,
      // the very next click draws a second shape instead of selecting the first.
      options.setTool('move')
      drag = null
      updateIdleCursor(screenOf(event))
      return
    }

    if (drag.kind === 'text') {
      // The caret already followed the pointer on the way here, and a sweep through text
      // edits nothing, so releasing has nothing to commit and nothing to record.
      drag = null
      updateIdleCursor(screenOf(event))
      return
    }

    if (drag.kind === 'marquee') {
      options.setMarquee(null)
      options.requestDraw()
      drag = null
      updateIdleCursor(screenOf(event))
      return
    }

    if (drag.kind === 'move' && drag.grouped) {
      if (drag.reorderFrame) {
        // The gesture's layouts all excluded the dragged node so it could float. One pass
        // without the exclusion is the release: the node snaps into the slot the siblings
        // have been holding open. Reparenting already happened live.
        relayout(document, [drag.reorderFrame])
      } else {
        // A node dropped over a different frame joins it. Done on release rather than during
        // the drag, so the tree does not churn while the pointer passes over things on its way.
        const target = containerAt(document, worldOf(screenOf(event)))
        const moved: NodeId[] = []
        const left: NodeId[] = []
        document.transact(() => {
          for (const dragged of drag?.nodes ?? []) {
            const node = document.getNode(dragged.id)
            // reparent already refuses a node's own descendant, so a frame dropped onto itself
            // simply stays where it is.
            if (node && node.parent !== target.id) {
              if (node.parent) left.push(node.parent)
              document.reparent(dragged.id, target.id)
              moved.push(dragged.id)
            }
          }
          if (moved.length > 0) relayout(document, [...moved, ...left])
        })
      }
    }

    if (drag.grouped) document.endHistoryGroup()
    drag = null
    updateIdleCursor(screenOf(event))
  }

  /**
   * The pointer left the canvas, so there is nothing under it to preview.
   *
   * Only when no gesture is running: a drag holds pointer capture and keeps going past the
   * edge, and clearing the outline there would be answering an event the gesture owns.
   */
  const onPointerLeave = (): void => {
    if (drag) return
    lastPointerScreen = null
    options.setHover(null)
    // The pointer left the canvas, so it left whatever it was over inside the prototype
    // too. Without this the element it was on keeps its hover state until the pointer comes
    // back and moves off it, which reads as a button stuck lit.
    const playing = options.getPlay()
    if (playing !== null && playHover !== null && playHoverAt === playGeneration()) {
      const leaveTarget = playTargetAt(playing, playHover, 'pointerLeave')
      if (leaveTarget) sendPlayEvent(playing, leaveTarget, 'pointerLeave', { x: 0, y: 0 })
    }
    playHover = null
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

  /**
   * Restores live document state to what it was before the cancelled gesture, undoing only
   * what that gesture itself did. `pan` is deliberately not handled: it is view state, never
   * touches the document or history, and releasing the pointer already ends it cleanly.
   *
   * Wherever this removes nodes it also puts the selection back, the same way `deleteSelection`
   * does: leaving it pointing at an id that no longer exists shows no handles and no properties
   * while still reading as a selection, so delete and nudge silently do nothing afterwards.
   */
  const cancelDrag = (current: Drag): void => {
    if (current.kind === 'move' && current.grouped) {
      const duplicatedFrom = current.duplicatedFrom
      document.transact(() => {
        const parents: NodeId[] = []
        for (const dragged of current.nodes) {
          // An option drag copy has no meaningful "before": it did not exist until this
          // gesture created it, so cancelling removes it rather than trying to restore it.
          if (duplicatedFrom) {
            const parent = document.getNode(dragged.id)?.parent
            if (parent) parents.push(parent)
            document.remove(dragged.id)
            continue
          }
          // The gesture may have reparented or reordered the node live on its way through
          // an auto layout frame, so the cancel walks it all the way back: parent first,
          // then place among the siblings, then the transform, which `origin` holds in the
          // original parent's space.
          const node = document.getNode(dragged.id)
          if (!node) continue
          if (node.parent) parents.push(node.parent)
          if (dragged.origin.parent && node.parent !== dragged.origin.parent) {
            document.reparent(dragged.id, dragged.origin.parent, dragged.origin.index)
            parents.push(dragged.origin.parent)
          } else if (document.indexOf(dragged.id) !== dragged.origin.index) {
            document.reorder(dragged.id, dragged.origin.index)
          }
          document.update(dragged.id, { transform: dragged.origin.transform })
        }
        // Deterministic and idempotent, so re-running the layout over the restored inputs
        // lands the siblings exactly where the gesture found them.
        relayout(document, [...current.nodes.map((dragged) => dragged.id), ...parents])
        // The originals never moved, so reselecting them leaves the gesture with no trace.
        if (duplicatedFrom) options.setSelection(duplicatedFrom)
      })
    } else if (current.kind === 'resize' && current.grouped) {
      if (current.localResize) {
        const { id, startTransform, startSize, startLayout, startLayoutChild } = current.localResize
        const node = document.getNode(id)
        document.transact(() => {
          document.update(id, {
            transform: startTransform,
            size: startSize,
            // Only put back what the gesture could have taken: a node that never had the
            // field must not gain a key holding undefined.
            ...(node?.type === 'frame' && node.layout ? { layout: startLayout } : {}),
            ...(node?.layoutChild ? { layoutChild: startLayoutChild } : {}),
          })
          relayout(document, [id])
        })
      } else if (current.resizing) {
        document.transact(() => {
          for (const target of current.resizing ?? []) {
            document.update(target.id, { transform: target.startTransform, size: target.startSize })
          }
          relayout(document, (current.resizing ?? []).map((target) => target.id))
        })
      }
    } else if (current.kind === 'rotate' && current.grouped && current.rotating && current.pivot) {
      // A zero delta recomputes each node's transform back through the same maths that moved
      // it, landing exactly on where it started.
      applyRotation(document, current.rotating, 0, current.pivot)
    } else if (current.kind === 'create' && current.created) {
      const created = current.created
      document.transact(() => {
        document.remove(created)
        options.setSelection(current.startSelection ?? [])
      })
    } else if (current.kind === 'marquee') {
      options.setSelection(current.marqueeBase ?? [])
      options.setMarquee(null)
    }

    if (current.grouped) document.abortHistoryGroup()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    // Escape leaves the prototype before it means anything else, and stops there: exiting
    // play and clearing the selection on one press would be two answers to one question.
    if (event.key === 'Escape' && !drag && options.getPlay() !== null) {
      event.preventDefault()
      event.stopImmediatePropagation()
      playPress = null
      playHover = null
      endPlay()
      return
    }
    if (event.key === 'Escape' && drag) {
      // Runs before keyboardInput.ts's own Escape handler (which clears the selection): this
      // listener is registered inside CanvasHost, a descendant of App, and React commits
      // child effects before parent ones. stopImmediatePropagation makes that ordering do the
      // work of keeping the two Escapes from fighting, rather than clearing the selection too.
      event.preventDefault()
      event.stopImmediatePropagation()
      const current = drag
      if (canvas.hasPointerCapture(current.pointerId)) canvas.releasePointerCapture(current.pointerId)
      drag = null
      cancelDrag(current)
      if (current.kind === 'marquee') options.requestDraw()
      if (lastPointerScreen) updateIdleCursor(lastPointerScreen)
      return
    }

    // Every other keyboard consumer in the app checks this and this one never did, which
    // only became visible with a text node to type into: a space would otherwise arm the
    // pan gesture and flip the canvas to a grab cursor mid word.
    if (isEditingText(event.target)) return

    if (event.code === 'Space') {
      spaceHeld = true
      if (!drag && lastPointerScreen) updateIdleCursor(lastPointerScreen)
    }
    reapplyModifiers(event)
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (isEditingText(event.target)) return
    if (event.code === 'Space') {
      spaceHeld = false
      if (!drag && lastPointerScreen) updateIdleCursor(lastPointerScreen)
    }
    reapplyModifiers(event)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}

const IDENTITY_MATRIX: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
