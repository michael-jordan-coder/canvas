import {
  invert,
  multiply,
  reflectAbout,
  type Mat2D,
  type NodeId,
  type SceneDocument,
  type Vec2,
} from '@figma-canvas/document'
import { selectionWorldBounds } from '@figma-canvas/renderer'
import { relayout } from './autoLayout'

/**
 * Flip, built on `reflectAbout` the way rotation is built on `rotateAbout`.
 *
 * Flip is a negative scale in the transform, not a boolean pair on the node. `scaleOf` already
 * carries a flip in the sign of y, and `packages/document/src/rotation.test.ts` already pins
 * that, so a stored flag would be a second source of truth for something the matrix can
 * already express, and one that could disagree with it.
 */
export type FlipAxis = 'horizontal' | 'vertical'

const IDENTITY_MATRIX: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

/**
 * Mirrors nodes across an axis through the centre of their combined bounds, so a group flips
 * together rather than each node mirroring in place about its own centre. Flip has one
 * gesture, unlike rotate, so the pivot is not a caller supplied point: it is always the
 * selection's own bounds.
 *
 * Composed in world space and mapped back through the inverse parent transform, exactly the
 * way `rotateNodes` composes a turn: a node inside a rotated or scaled frame has a local
 * transform in units that are not the ones the mirror line is drawn in.
 *
 * The pivot is taken from the full selection before locked nodes are dropped, so a locked
 * node still anchors where the rest of the group mirrors to, the same way it would if it were
 * simply left where it was during a group rotate.
 */
export function flipNodes(document: SceneDocument, ids: readonly NodeId[], axis: FlipAxis): void {
  if (ids.length === 0) return
  const bounds = selectionWorldBounds(document, ids)
  if (!bounds) return
  const pivot: Vec2 = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const mirror = reflectAbout(pivot, axis)

  document.transact(() => {
    for (const id of ids) {
      const node = document.getNode(id)
      if (!node || node.locked) continue
      const world = document.worldTransform(id)
      const parentWorld = node.parent ? document.worldTransform(node.parent) : IDENTITY_MATRIX
      // world, then the mirror, then back out of the parent's space into local units.
      document.update(id, { transform: multiply(multiply(world, mirror), invert(parentWorld)) })
    }
    // A mirrored child swaps sides inside its parent's flow just as a resized one would.
    relayout(document, ids)
  })
}
