import {
  applyToPoint,
  createEllipse,
  createFrame,
  createRectangle,
  fromHex,
  type Mat2D,
  type Rect,
  type SceneNode,
  type Size,
  type Vec2,
} from '@canvas/document'
import type { ToolId } from '../state/uiStore'
import type { Modifiers } from './dragState'
import { rectBetween } from './clickIntent'

/** Drawn when a shape tool is clicked rather than dragged. */
export const DEFAULT_SHAPE_SIZE = 100

export const SHAPE_TOOLS = new Set<ToolId>(['rectangle', 'ellipse', 'frame'])

export function createNodeForTool(tool: ToolId): SceneNode | null {
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

/** The box a create drag describes, in world space, with shift and alt applied. */
export function createBox(startWorld: Vec2, pointer: Vec2, modifiers: Modifiers): Rect {
  let box = rectBetween(startWorld, pointer)
  if (modifiers.constrain) {
    const side = Math.max(box.width, box.height)
    box = { ...box, width: side, height: side }
  }
  if (modifiers.fromCentre) {
    // The start point becomes the centre rather than a corner.
    const halfWidth = Math.abs(pointer.x - startWorld.x)
    const halfHeight = Math.abs(pointer.y - startWorld.y)
    const side = modifiers.constrain ? Math.max(halfWidth, halfHeight) : 0
    const width = modifiers.constrain ? side * 2 : halfWidth * 2
    const height = modifiers.constrain ? side * 2 : halfHeight * 2
    box = {
      x: startWorld.x - width / 2,
      y: startWorld.y - height / 2,
      width,
      height,
    }
  }
  return box
}

/**
 * The world box expressed in the parent's space, as the origin and size the node stores.
 *
 * Positions are stored in the parent's space, so a shape drawn inside a scaled frame lands
 * under the cursor rather than somewhere proportionally off.
 */
export function placedInParent(toParent: Mat2D, box: Rect): { origin: Vec2; size: Size } {
  const origin = applyToPoint(toParent, { x: box.x, y: box.y })
  const far = applyToPoint(toParent, { x: box.x + box.width, y: box.y + box.height })
  return {
    origin,
    size: { width: Math.abs(far.x - origin.x), height: Math.abs(far.y - origin.y) },
  }
}
