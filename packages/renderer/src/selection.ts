import {
  angleOf,
  applyToPoint,
  multiply,
  scaleOf,
  transformRect,
  type NodeId,
  type Rect,
  type SceneDocument,
  type Vec2,
} from '@figma-canvas/document'
import { viewMatrix, type Camera, type Viewport } from './camera.js'

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

    // Built out from the node's own centre rather than by unrotating the matrix, because the
    // box is turned about that centre and unrotating a matrix turns about the origin. Those
    // are the same point only when the node happens to sit on it.
    const centre = applyToPoint(screen, {
      x: node.size.width / 2,
      y: node.size.height / 2,
    })
    const width = node.size.width * Math.abs(scale.x)
    const height = node.size.height * Math.abs(scale.y)
    const rect = {
      x: centre.x - width / 2,
      y: centre.y - height / 2,
      width,
      height,
    }
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

/** Handle centres for a box, in whatever space the box is in. */
export function handlePoints(bounds: Rect): HandlePoint[] {
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height
  const middleX = bounds.x + bounds.width / 2
  const middleY = bounds.y + bounds.height / 2

  const points: HandlePoint[] = [
    { id: 'nw', x: bounds.x, y: bounds.y },
    { id: 'ne', x: right, y: bounds.y },
    { id: 'sw', x: bounds.x, y: bottom },
    { id: 'se', x: right, y: bottom },
  ]
  if (bounds.width >= EDGE_HANDLE_MINIMUM) {
    points.push({ id: 'n', x: middleX, y: bounds.y }, { id: 's', x: middleX, y: bottom })
  }
  if (bounds.height >= EDGE_HANDLE_MINIMUM) {
    points.push({ id: 'w', x: bounds.x, y: middleY }, { id: 'e', x: right, y: middleY })
  }
  return points
}

/**
 * Which handle is under a screen point, if any.
 *
 * The point is mapped into the box's own frame first, so the axis aligned test below is the
 * only one that ever has to exist. Corners are tested before edges, because their grab areas
 * overlap on a small box and the corner is almost always what was meant.
 */
export function handleAt(box: SelectionBox, point: Vec2): HandleId | null {
  const local = toBoxSpace(box, point)
  const reach = HANDLE_GRAB / 2
  const points = handlePoints(box.rect)
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
export function grabAt(box: SelectionBox, point: Vec2): GrabId | null {
  const local = toBoxSpace(box, point)
  const rotate = rotateHandlePoint(box.rect)
  const reach = ROTATE_HANDLE_GRAB / 2
  if (Math.abs(local.x - rotate.x) <= reach && Math.abs(local.y - rotate.y) <= reach) {
    return 'rotate'
  }
  return handleAt(box, point)
}

/** Where a point on the box lands on screen, rotation included. */
export function handleScreenPoint(box: SelectionBox, handle: HandleId): Vec2 {
  const found = handlePoints(box.rect).find((point) => point.id === handle)
  const fallback = boxCentre(box.rect)
  return fromBoxSpace(box, found ? { x: found.x, y: found.y } : fallback)
}
