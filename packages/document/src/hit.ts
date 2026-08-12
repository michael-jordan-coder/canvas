import type { SceneDocument } from './document.js'
import {
  applyToPoint,
  invert,
  multiply,
  transformRect,
  type Mat2D,
  type Rect,
  type Vec2,
} from './math.js'
import { canHaveChildren, isPainted, type NodeId, type SceneNode } from './node.js'

/**
 * Distance from a point to a rounded box, negative inside. The same function the fragment
 * shader uses, so what you can click is exactly what you can see, including the bite the
 * corner radius takes out of each corner.
 */
function distanceToRoundedBox(p: Vec2, half: Vec2, radius: number): number {
  const r = Math.min(radius, Math.min(half.x, half.y))
  const qx = Math.abs(p.x) - half.x + r
  const qy = Math.abs(p.y) - half.y + r
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - r
}

/** `point` is in the node's own space, where the node spans 0..size. */
export function containsPoint(node: SceneNode, point: Vec2): boolean {
  if (!isPainted(node)) return false

  const half = { x: node.size.width / 2, y: node.size.height / 2 }
  if (half.x <= 0 || half.y <= 0) return false

  const p = { x: point.x - half.x, y: point.y - half.y }

  if (node.type === 'ellipse') {
    const nx = p.x / half.x
    const ny = p.y / half.y
    return nx * nx + ny * ny <= 1
  }

  return distanceToRoundedBox(p, half, node.cornerRadius) <= 0
}

/**
 * The topmost node under a world point, or null.
 *
 * Walks children last to first, because the instance buffer draws them first to last: the
 * one painted most recently is the one on top, and the one on top is the one you clicked.
 *
 * Note this selects the deepest hit node, so clicking a rectangle inside a frame selects the
 * rectangle. Figma selects the outermost frame first and makes you double click to descend.
 * That is a UI policy rather than a geometry question, so it belongs above this function.
 */
export function hitTest(document: SceneDocument, point: Vec2): SceneNode | null {
  for (const child of [...document.getChildren(document.rootId)].reverse()) {
    const found = hitNode(document, child, IDENTITY_MATRIX, point)
    if (found) return found
  }
  return null
}

const IDENTITY_MATRIX: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

/**
 * The deepest node that can hold children containing a world point, falling back to the page.
 *
 * This is what decides the parent of a newly drawn shape: draw inside a frame and the shape
 * belongs to that frame, so it moves with it afterwards.
 */
export function containerAt(document: SceneDocument, point: Vec2): SceneNode {
  const page = document.expectNode(document.rootId)

  const descend = (node: SceneNode, parent: Mat2D): SceneNode | null => {
    if (!node.visible || node.locked) return null
    const world = multiply(node.transform, parent)

    const children = document.getChildren(node.id)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (!child) continue
      const found = descend(child, world)
      if (found) return found
    }

    if (!canHaveChildren(node)) return null
    return containsPoint(node, applyToPoint(invert(world), point)) ? node : null
  }

  for (const child of [...document.getChildren(page.id)].reverse()) {
    const found = descend(child, IDENTITY_MATRIX)
    if (found) return found
  }
  return page
}

/** A node's axis aligned bounds in world space. */
export function worldBounds(document: SceneDocument, id: NodeId): Rect | null {
  const node = document.getNode(id)
  if (!node) return null
  return transformRect(document.worldTransform(id), {
    x: 0,
    y: 0,
    width: node.size.width,
    height: node.size.height,
  })
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  )
}

function encloses(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/**
 * Everything a marquee catches, in world space.
 *
 * Shapes are caught by touching the rect at all, which is what Figma does and what people
 * expect from a rubber band. Containers are the exception: a frame is only caught when the
 * marquee swallows it whole, and otherwise the marquee reaches inside and catches the
 * children it touches. Without that, dragging a small box inside a large frame would select
 * the frame, since the frame is certainly touching the rect.
 */
export function nodesIn(document: SceneDocument, rect: Rect): SceneNode[] {
  const found: SceneNode[] = []

  const visit = (node: SceneNode, parent: Mat2D): void => {
    if (!node.visible || node.locked) return
    const world = multiply(node.transform, parent)
    const bounds = transformRect(world, {
      x: 0,
      y: 0,
      width: node.size.width,
      height: node.size.height,
    })

    if (canHaveChildren(node)) {
      if (encloses(rect, bounds)) {
        found.push(node)
        return
      }
      for (const child of document.getChildren(node.id)) visit(child, world)
      return
    }

    if (overlaps(rect, bounds)) found.push(node)
  }

  for (const child of document.getChildren(document.rootId)) visit(child, IDENTITY_MATRIX)
  return found
}

function hitNode(
  document: SceneDocument,
  node: SceneNode,
  parent: Mat2D,
  point: Vec2,
): SceneNode | null {
  // Hidden nodes hide their children, exactly as they do when drawing.
  if (!node.visible) return null

  const world = multiply(node.transform, parent)

  const children = document.getChildren(node.id)
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i]
    if (!child) continue
    const found = hitNode(document, child, world, point)
    if (found) return found
  }

  if (node.locked) return null

  // Into the node's own space, where the containment test is a plain box or ellipse
  // regardless of how the node is rotated or scaled in the world.
  return containsPoint(node, applyToPoint(invert(world), point)) ? node : null
}
