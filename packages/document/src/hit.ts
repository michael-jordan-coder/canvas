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
import {
  canHaveChildren,
  hasBounds,
  isPainted,
  type BoxedNode,
  type NodeId,
  type SceneNode,
} from './node.js'
import { strokesOutset } from './paint.js'
import {
  distanceToRoundedBox,
  resolveCornerRadii,
  uniformCornerRadii,
  type CornerRadii,
} from './sdf.js'

/**
 * `point` is in the node's own space, where the node spans 0..size.
 *
 * A stroke that sits outside the edge is part of what you can see, so it is part of what you
 * can click. An inside stroke adds nothing, which is the same reason it leaves the node's
 * drawn footprint alone. With several strokes it is the widest reach that counts, since all
 * of them are drawn at once and the area has to cover the outermost. Note the whole interior
 * stays clickable even when a node has only a stroke and no fill: Figma would make you hit
 * the outline itself, which is precise and unpleasant, and nothing here needs that yet.
 */
export function containsPoint(node: SceneNode, point: Vec2): boolean {
  if (!hasBounds(node)) return false
  // A text node carries strokes because every painted node does, but nothing draws them yet.
  // Growing its clickable area for a stroke that is not on screen would break the one rule
  // this file exists to keep: you can click exactly what you can see. A hidden stroke is
  // dropped by `strokesOutset` for that same reason. A component node has no strokes at all:
  // what it looks like belongs to the React component, and its box is exactly its bounds.
  const outset = isPainted(node) && node.type !== 'text' ? strokesOutset(node.strokes) : 0
  return withinShape(node, point, outset)
}

const SQUARE_CORNERS = uniformCornerRadii()

/**
 * Ellipses have no corner, a text node's box is its layout bounds, and a component's box is
 * the rectangle its DOM mount occupies. All three are square cornered here.
 */
function cornerRadiiOf(node: BoxedNode): CornerRadii {
  return node.type === 'frame' || node.type === 'rectangle' ? node.cornerRadii : SQUARE_CORNERS
}

function withinShape(node: SceneNode, point: Vec2, outset: number): boolean {
  if (!hasBounds(node)) return false

  const half = { x: node.size.width / 2, y: node.size.height / 2 }
  if (half.x <= 0 || half.y <= 0) return false

  const p = { x: point.x - half.x, y: point.y - half.y }

  if (node.type === 'ellipse') {
    const nx = p.x / (half.x + outset)
    const ny = p.y / (half.y + outset)
    return nx * nx + ny * ny <= 1
  }

  // Growing the box rather than subtracting from the distance, because the corner radius
  // grows with an outward stroke too: the outer edge of a stroke around a rounded corner is
  // a wider arc, not the same arc pushed out squarely. The grown radii are then resolved
  // against the grown box, since that is the shape being asked about.
  const grown = { x: half.x + outset, y: half.y + outset }
  const radii = cornerRadiiOf(node)
  const resolved = resolveCornerRadii(
    { width: grown.x * 2, height: grown.y * 2 },
    {
      topLeft: radii.topLeft + outset,
      topRight: radii.topRight + outset,
      bottomRight: radii.bottomRight + outset,
      bottomLeft: radii.bottomLeft + outset,
    },
  )
  return distanceToRoundedBox(p, grown, resolved) <= 0
}

/**
 * Whether a frame hides whatever sits at this point in its own space.
 *
 * The clip is the frame's geometry, so the stroke is deliberately left out of it: painting
 * a thick outside stroke on a frame must not enlarge the region its children are allowed to
 * appear in.
 */
function clipsAway(node: SceneNode, local: Vec2): boolean {
  return node.type === 'frame' && node.clipsContent && !withinShape(node, local, 0)
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
 *
 * `exclude` skips whole subtrees. The reorder drag passes the node being dragged, because
 * asking "what would hold this?" about a frame must not answer with the frame itself.
 */
export function containerAt(
  document: SceneDocument,
  point: Vec2,
  exclude?: ReadonlySet<NodeId>,
): SceneNode {
  const page = document.expectNode(document.rootId)

  const descend = (node: SceneNode, parent: Mat2D): SceneNode | null => {
    if (!node.visible || node.locked || exclude?.has(node.id)) return null
    const world = multiply(node.transform, parent)
    const local = applyToPoint(invert(world), point)

    if (!clipsAway(node, local)) {
      const children = document.getChildren(node.id)
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index]
        if (!child) continue
        const found = descend(child, world)
        if (found) return found
      }
    }

    if (!canHaveChildren(node)) return null
    return containsPoint(node, local) ? node : null
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

  // What is still visible after every enclosing clip, in world space, or null for unclipped.
  // Rectangles are enough here because everything this function compares is already an axis
  // aligned bound rather than the exact shape.
  const visit = (node: SceneNode, parent: Mat2D, clip: Rect | null): void => {
    if (!node.visible || node.locked) return
    const world = multiply(node.transform, parent)
    const bounds = transformRect(world, {
      x: 0,
      y: 0,
      width: node.size.width,
      height: node.size.height,
    })

    // Clipped out entirely: nothing of this node or its children is on screen to catch.
    const shown = clip ? intersection(clip, bounds) : bounds
    if (!shown) return

    if (canHaveChildren(node)) {
      if (encloses(rect, shown)) {
        found.push(node)
        return
      }
      const inner = node.type === 'frame' && node.clipsContent ? shown : clip
      for (const child of document.getChildren(node.id)) visit(child, world, inner)
      return
    }

    if (overlaps(rect, shown)) found.push(node)
  }

  for (const child of document.getChildren(document.rootId)) visit(child, IDENTITY_MATRIX, null)
  return found
}

/** The overlap of two rects, or null when they do not touch. */
function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
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
  // Into the node's own space, where the containment test is a plain box or ellipse
  // regardless of how the node is rotated or scaled in the world.
  const local = applyToPoint(invert(world), point)

  // A child the frame clips out is not on screen, so it is not clickable either. Testing
  // once here rather than per child is also what stops a big clipping frame paying for a
  // walk over contents none of which can be reached.
  if (!clipsAway(node, local)) {
    const children = document.getChildren(node.id)
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i]
      if (!child) continue
      const found = hitNode(document, child, world, point)
      if (found) return found
    }
  }

  if (node.locked) return null

  return containsPoint(node, local) ? node : null
}
