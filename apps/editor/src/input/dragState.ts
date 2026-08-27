import type {
  FrameLayout,
  LayoutChild,
  Mat2D,
  NodeId,
  Rect,
  Size,
  Vec2,
} from '@canvas/document'
import type { Camera, HandleId } from '@canvas/renderer'
import type { RotateTarget } from '../state/rotate'
import type { ToolId } from '../state/uiStore'
import type { ResizeTarget } from './resize'

/**
 * The state a gesture carries from pointer down to release. Owned by the pointer layer;
 * shared here so the gesture modules can read and write it without importing the layer that
 * dispatches to them.
 */

export interface DraggedNode {
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

export interface ResizedNode extends ResizeTarget {
  id: NodeId
}

/**
 * A single node resizes in its own frame, so dragging its east handle lengthens it along its
 * own x axis however it is turned. Resolved once at grab time: the linear part does not change
 * during a resize, but the translation does, so recomputing this mid gesture would drift.
 */
export interface LocalResize {
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

export interface Drag {
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

export interface Modifiers {
  /** Anchor to the centre rather than the opposite corner. */
  fromCentre: boolean
  /** Hold the aspect ratio. */
  constrain: boolean
}
