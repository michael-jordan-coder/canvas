import {
  angleOf,
  applyToPoint,
  caretRect,
  multiply,
  scaleOf,
  selectionRects,
  transformRect,
  type FontMetrics,
  type Mat2D,
  type NodeId,
  type Rect,
  type SceneDocument,
  type TextLayoutCache,
  type Vec2,
} from '@figma-canvas/document'
import { viewMatrix, type Camera, type Viewport } from './camera.js'
import type { TextEditing } from './Renderer.js'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/**
 * What a pointer can take hold of on the selection.
 *
 * Deliberately a wider type than `HandleId` rather than another member of it, because the
 * resize maths asks questions like `handle.includes('e')` and 'rotate' would answer yes.
 * Keeping them separate turns that into a compile error instead of a shape that scales
 * sideways when you meant to turn it.
 */
export type GrabId = HandleId | 'rotate'

const ALL_HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Drawn size in CSS pixels. */
export const HANDLE_SIZE = 8
/** Grab area, a little larger than the drawn handle so the corners are not fiddly. */
export const HANDLE_GRAB = 11
export const OUTLINE_WIDTH = 1
/** Below this, the edge handles would collide with the corner ones, so they are dropped. */
export const EDGE_HANDLE_MINIMUM = 24

/** How far above the top edge the rotate handle floats, centre to edge, in CSS pixels. */
export const ROTATE_HANDLE_DISTANCE = 20
/** Drawn a little smaller than a resize handle, since it is round and reads heavier. */
export const ROTATE_HANDLE_SIZE = 7
export const ROTATE_HANDLE_GRAB = 13

/**
 * The selection box in world units.
 *
 * Axis aligned in world space, which is right for a multiple selection and wrong for a single
 * rotated node. `selectionBox` is what callers should reach for; this stays exported because
 * the input layer resizes against a world aligned box.
 */
export function selectionWorldBounds(
  document: SceneDocument,
  selection: readonly NodeId[],
): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of selection) {
    const node = document.getNode(id)
    if (!node) continue
    const box = transformRect(document.worldTransform(id), {
      x: 0,
      y: 0,
      width: node.size.width,
      height: node.size.height,
    })
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }

  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * The selection box in CSS pixels, with the angle it is drawn at.
 *
 * `rect` is the box in its own upright frame and `angle` turns it about its centre. Every
 * consumer works in that frame and then rotates, which is what keeps the outline, the handles
 * and handle hit testing from each needing their own trigonometry.
 */
export interface SelectionBox {
  rect: Rect
  /** Radians, clockwise, because screen y points down. Zero for a multiple selection. */
  angle: number
}

/** The centre of a box, in whatever space the box is in. */
export function boxCentre(rect: Rect): Vec2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/**
 * Maps a point from screen space into the box's own upright frame.
 *
 * Everything that asks "where is this on the box" goes through here first, so a rotated box
 * answers with the same code an upright one does.
 */
export function toBoxSpace(box: SelectionBox, point: Vec2): Vec2 {
  if (box.angle === 0) return point
  const centre = boxCentre(box.rect)
  const cos = Math.cos(-box.angle)
  const sin = Math.sin(-box.angle)
  const dx = point.x - centre.x
  const dy = point.y - centre.y
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos }
}

/** The reverse: a point on the upright box, placed where it is actually drawn. */
export function fromBoxSpace(box: SelectionBox, point: Vec2): Vec2 {
  if (box.angle === 0) return point
  const centre = boxCentre(box.rect)
  const cos = Math.cos(box.angle)
  const sin = Math.sin(box.angle)
  const dx = point.x - centre.x
  const dy = point.y - centre.y
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos }
}

/**
 * A rect in a node's own space, placed where it is actually drawn, in CSS pixels.
 *
 * Built out from the rect's centre rather than by unrotating the matrix, because a box is
 * turned about its centre and unrotating a matrix turns about the origin. Those are the same
 * point only when the node happens to sit on it. The result is an upright rect, which the
 * overlay pairs with the angle to draw a turned one.
 *
 * Shared by the selection box and the caret so the two cannot disagree under rotation or a
 * non-uniform scale, which is exactly where they would drift apart.
 */
function placeLocalRect(screen: Mat2D, scale: Vec2, local: Rect): Rect {
  const centre = applyToPoint(screen, {
    x: local.x + local.width / 2,
    y: local.y + local.height / 2,
  })
  const width = local.width * Math.abs(scale.x)
  const height = local.height * Math.abs(scale.y)
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height }
}

/**
 * The box to draw and to grab, in CSS pixels.
 *
 * A single node carries its own basis, so a rotated rectangle gets a box turned to match
 * rather than an upright one loose around it. A multiple selection collapses to an upright
 * box, because two nodes at different angles have no shared basis and Figma does the same.
 */
export function selectionBox(
  document: SceneDocument,
  selection: readonly NodeId[],
  camera: Camera,
  viewport: Viewport,
): SelectionBox | null {
  const view = viewMatrix(camera, viewport)
  const only = selection.length === 1 ? selection[0] : undefined
  const node = only ? document.getNode(only) : undefined

  if (node) {
    const screen = multiply(document.worldTransform(node.id), view)
    const angle = angleOf(screen)
    const scale = scaleOf(screen)

    const rect = placeLocalRect(screen, scale, {
      x: 0,
      y: 0,
      width: node.size.width,
      height: node.size.height,
    })
    // Snapping a turned box shifts its centre and therefore everything hung off it, and it
    // cannot land on a pixel grid anyway, so it is left alone.
    return { rect: angle === 0 ? snap(rect) : rect, angle }
  }

  const world = selectionWorldBounds(document, selection)
  if (!world) return null
  return { rect: snap(transformRect(view, world)), angle: 0 }
}

/** Snapped so a one pixel stroke lands on one pixel rather than straddling two. */
function snap(rect: Rect): Rect {
  return {
    x: Math.round(rect.x) + 0.5,
    y: Math.round(rect.y) + 0.5,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

export interface HandlePoint {
  id: HandleId
  x: number
  y: number
}

/**
 * Handle centres for a box, in whatever space the box is in.
 *
 * `allowed` narrows the set, which text uses to offer its two side handles and nothing else.
 * It also decides whether the crowding minimums apply: they exist so an edge handle does not
 * sit on top of a corner one on a small box, so with no corners in the set there is nothing
 * to crowd and a short box keeps its side handles. Without that a line of text, which is
 * always shorter than the minimum, would offer no handles at all.
 */
export function handlePoints(bounds: Rect, allowed: readonly HandleId[] = ALL_HANDLES): HandlePoint[] {
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height
  const middleX = bounds.x + bounds.width / 2
  const middleY = bounds.y + bounds.height / 2

  const corners = (
    [
      { id: 'nw', x: bounds.x, y: bounds.y },
      { id: 'ne', x: right, y: bounds.y },
      { id: 'sw', x: bounds.x, y: bottom },
      { id: 'se', x: right, y: bottom },
    ] satisfies HandlePoint[]
  ).filter((handle) => allowed.includes(handle.id))

  const crowded = corners.length > 0
  const edges: HandlePoint[] = []
  if (!crowded || bounds.width >= EDGE_HANDLE_MINIMUM) {
    edges.push({ id: 'n', x: middleX, y: bounds.y }, { id: 's', x: middleX, y: bottom })
  }
  if (!crowded || bounds.height >= EDGE_HANDLE_MINIMUM) {
    edges.push({ id: 'w', x: bounds.x, y: middleY }, { id: 'e', x: right, y: middleY })
  }
  return [...corners, ...edges.filter((handle) => allowed.includes(handle.id))]
}

/**
 * Which handle is under a screen point, if any.
 *
 * The point is mapped into the box's own frame first, so the axis aligned test below is the
 * only one that ever has to exist. Corners are tested before edges, because their grab areas
 * overlap on a small box and the corner is almost always what was meant.
 */
export function handleAt(
  box: SelectionBox,
  point: Vec2,
  allowed: readonly HandleId[] = ALL_HANDLES,
): HandleId | null {
  const local = toBoxSpace(box, point)
  const reach = HANDLE_GRAB / 2
  const points = handlePoints(box.rect, allowed)
  const corners = points.filter((handle) => handle.id.length === 2)
  const edges = points.filter((handle) => handle.id.length === 1)

  for (const handle of [...corners, ...edges]) {
    if (Math.abs(local.x - handle.x) <= reach && Math.abs(local.y - handle.y) <= reach) {
      return handle.id
    }
  }
  return null
}

/**
 * Where the rotate handle sits, in the box's own upright frame.
 *
 * Above the top edge on a short stem, which is the one place around a rectangle that never
 * collides with a resize handle however small the box gets.
 */
export function rotateHandlePoint(bounds: Rect): Vec2 {
  return { x: bounds.x + bounds.width / 2, y: bounds.y - ROTATE_HANDLE_DISTANCE }
}

/**
 * What is under a screen point: a resize handle, the rotate handle, or nothing.
 *
 * Rotate is tested first. It sits clear of the box on its own stem, so the two only ever
 * compete on a box short enough that the stem reaches back over the bottom edge, and there
 * the thing the pointer is actually on is the one it is nearest.
 */
export function grabAt(
  box: SelectionBox,
  point: Vec2,
  allowed: readonly HandleId[] = ALL_HANDLES,
): GrabId | null {
  const local = toBoxSpace(box, point)
  const rotate = rotateHandlePoint(box.rect)
  const reach = ROTATE_HANDLE_GRAB / 2
  if (Math.abs(local.x - rotate.x) <= reach && Math.abs(local.y - rotate.y) <= reach) {
    return 'rotate'
  }
  return handleAt(box, point, allowed)
}

/** Where a point on the box lands on screen, rotation included. */
export function handleScreenPoint(box: SelectionBox, handle: HandleId): Vec2 {
  const found = handlePoints(box.rect).find((point) => point.id === handle)
  const fallback = boxCentre(box.rect)
  return fromBoxSpace(box, found ? { x: found.x, y: found.y } : fallback)
}

/**
 * Text resizes sideways only. Its width is the width its lines wrap to, which is a real
 * setting, but its height is however many lines that produces, which is not the handle's to
 * set. Offering a south handle would be offering to fight the layout.
 */
const TEXT_HANDLES: readonly HandleId[] = ['e', 'w']

/**
 * Which resize handles a selection offers.
 *
 * Asked in one place so the overlay and the input layer cannot disagree about what can be
 * grabbed. A handle that is drawn and not grabbable is worse than one that is missing.
 */
export function resizeHandlesFor(
  document: SceneDocument,
  selection: readonly NodeId[],
): readonly HandleId[] {
  const only = selection.length === 1 ? selection[0] : undefined
  return only && document.getNode(only)?.type === 'text' ? TEXT_HANDLES : ALL_HANDLES
}

/** One CSS pixel wide at every zoom, the same rule the handles follow. */
export const CARET_WIDTH = 1

export interface TextEditingBoxes {
  /** The caret, and one rect per line the selection covers. All in CSS pixels. */
  caret: Rect
  selection: Rect[]
  /** Shared by all of them, since they all sit in the node's own frame. */
  angle: number
}

/**
 * Where to draw the caret and the selection highlight, in CSS pixels.
 *
 * Built from the same layout the glyphs are packed from, so the caret cannot drift away from
 * the text it sits in. Everything comes out as an upright rect plus an angle, which is what
 * the overlay draws and is why a caret in a rotated text node needs no special case.
 */
export function textEditingBoxes(
  document: SceneDocument,
  editing: TextEditing,
  metrics: FontMetrics,
  layouts: TextLayoutCache,
  camera: Camera,
  viewport: Viewport,
): TextEditingBoxes | null {
  const node = document.getNode(editing.id)
  if (!node || node.type !== 'text') return null

  const screen = multiply(document.worldTransform(node.id), viewMatrix(camera, viewport))
  const angle = angleOf(screen)
  const scale = scaleOf(screen)
  // Through the cache, so the blinking caret costs nothing between keystrokes: the overlay
  // rebuilds twice a second over text that has not changed since it was typed.
  const layout = layouts.layoutFor(node, metrics)

  const place = (local: Rect): Rect => placeLocalRect(screen, scale, local)

  // The caret has no width in the document, so it gets its pixel width here. A caret that
  // scaled with the zoom would be invisible at 10% and a slab at 3000%.
  const caret = place(caretRect(layout, editing.caret))
  caret.x = caret.x - CARET_WIDTH / 2
  caret.width = CARET_WIDTH

  return {
    caret,
    selection: selectionRects(layout, editing.anchor, editing.caret).map(place),
    angle,
  }
}
