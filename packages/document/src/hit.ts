import type { SceneDocument } from './document.js'
import { applyToPoint, invert, multiply, type Mat2D, type Vec2 } from './math.js'
import { isPainted, type SceneNode } from './node.js'

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
