import {
  transformRect,
  type NodeId,
  type Rect,
  type SceneDocument,
  type Vec2,
} from '@figma-canvas/document'
import { viewMatrix, type Camera, type Viewport } from './camera.js'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Drawn size in CSS pixels. */
export const HANDLE_SIZE = 8
/** Grab area, a little larger than the drawn handle so the corners are not fiddly. */
export const HANDLE_GRAB = 11
export const OUTLINE_WIDTH = 1
/** Below this, the edge handles would collide with the corner ones, so they are dropped. */
export const EDGE_HANDLE_MINIMUM = 24

/**
 * The selection box in world units.
 *
 * Axis aligned, so a rotated node gets an upright box around it. Nothing can rotate through
 * the UI yet. When that changes, a single selection should carry the node's own basis
 * instead of collapsing to an AABB.
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
 * The same box in CSS pixels, snapped so a one pixel stroke lands on one pixel rather than
 * straddling two.
 *
 * Both the overlay and handle hit testing go through this, so what you can grab is always
 * exactly what you can see.
 */
export function selectionScreenBounds(
  document: SceneDocument,
  selection: readonly NodeId[],
  camera: Camera,
  viewport: Viewport,
): Rect | null {
  const world = selectionWorldBounds(document, selection)
  if (!world) return null
  const screen = transformRect(viewMatrix(camera, viewport), world)
  return {
    x: Math.round(screen.x) + 0.5,
    y: Math.round(screen.y) + 0.5,
    width: Math.round(screen.width),
    height: Math.round(screen.height),
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
 * Corners are tested before edges, because their grab areas overlap on a small box and the
 * corner is almost always what was meant.
 */
export function handleAt(bounds: Rect, point: Vec2): HandleId | null {
  const reach = HANDLE_GRAB / 2
  const points = handlePoints(bounds)
  const corners = points.filter((handle) => handle.id.length === 2)
  const edges = points.filter((handle) => handle.id.length === 1)

  for (const handle of [...corners, ...edges]) {
    if (Math.abs(point.x - handle.x) <= reach && Math.abs(point.y - handle.y) <= reach) {
      return handle.id
    }
  }
  return null
}
