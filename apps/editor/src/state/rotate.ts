import {
  angleOf,
  applyToPoint,
  invert,
  multiply,
  radians,
  rotateAbout,
  type Mat2D,
  type NodeId,
  type SceneDocument,
  type Vec2,
} from '@figma-canvas/document'

/**
 * Rotation commands, built on `rotateAbout` the same way the z-order commands are built on
 * `reorder`. The scene model offers the transform, the editor decides what people reach for.
 */

/** What shift snaps to. Twenty four steps around the circle, which is what Figma uses. */
export const SNAP_DEGREES = 15

/**
 * The delta to actually apply once shift has had its say.
 *
 * With one node the snap lands on the node's own absolute angle, so holding shift puts it on
 * exactly 45 rather than 45 away from wherever it happened to start. With more than one there
 * is no shared starting angle to land on, so the delta itself is snapped and the selection
 * turns together in steps.
 */
export function snapDelta(delta: number, startAngle: number | null): number {
  const step = radians(SNAP_DEGREES)
  if (startAngle === null) return Math.round(delta / step) * step
  return Math.round((startAngle + delta) / step) * step - startAngle
}

/** Everything needed to turn one node, resolved once when the gesture begins. */
export interface RotateTarget {
  id: NodeId
  /** World to parent space, so a world rotation comes back as the local transform stored. */
  parentInverse: Mat2D
  startWorld: Mat2D
}

export function rotateTargetsFor(
  document: SceneDocument,
  ids: readonly NodeId[],
): RotateTarget[] {
  return ids.flatMap((id) => {
    const node = document.getNode(id)
    if (!node || node.locked) return []
    return [
      {
        id,
        parentInverse: invert(
          node.parent ? document.worldTransform(node.parent) : IDENTITY_MATRIX,
        ),
        startWorld: document.worldTransform(id),
      },
    ]
  })
}

/**
 * Turns targets to an absolute offset from where they started.
 *
 * Absolute rather than incremental, because a drag calls this once per frame. Adding a small
 * delta to the current transform each time would accumulate float error over a long gesture
 * and, worse, would fight with snapping: the moment shift is held the angle has to be able to
 * jump backwards to the nearest step.
 */
export function applyRotation(
  document: SceneDocument,
  targets: readonly RotateTarget[],
  delta: number,
  centre: Vec2,
): void {
  const turn = rotateAbout(centre, delta)
  document.transact(() => {
    for (const target of targets) {
      document.update(target.id, {
        transform: multiply(multiply(target.startWorld, turn), target.parentInverse),
      })
    }
  })
}

/** The middle of a node, in world space. */
export function worldCentre(document: SceneDocument, id: NodeId): Vec2 | null {
  const node = document.getNode(id)
  if (!node) return null
  return applyToPoint(document.worldTransform(id), {
    x: node.size.width / 2,
    y: node.size.height / 2,
  })
}

/**
 * Turns nodes by `delta` radians about one shared world point.
 *
 * Composed in world space and mapped back, rather than added to each node's local transform,
 * because a node inside a rotated or scaled frame has a local transform in units that are not
 * the ones being rotated. Going through world is the only version that holds for both.
 */
export function rotateNodes(
  document: SceneDocument,
  ids: readonly NodeId[],
  delta: number,
  centre: Vec2,
): void {
  if (delta === 0 || ids.length === 0) return
  const turn = rotateAbout(centre, delta)

  document.transact(() => {
    for (const id of ids) {
      const node = document.getNode(id)
      if (!node || node.locked) continue
      const world = document.worldTransform(id)
      const parentWorld = node.parent ? document.worldTransform(node.parent) : IDENTITY_MATRIX
      // world, then the turn, then back out of the parent's space into local units.
      document.update(id, { transform: multiply(multiply(world, turn), invert(parentWorld)) })
    }
  })
}

/**
 * Turns each node to an absolute angle, about its own centre.
 *
 * Each about its own centre rather than the selection's, because this is the panel field: a
 * row of shapes all set to 30 degrees should each turn in place, not swing around a shared
 * point the way a drag on the rotate handle does.
 */
export function setNodesAngle(
  document: SceneDocument,
  ids: readonly NodeId[],
  angle: number,
): void {
  document.transact(() => {
    for (const id of ids) {
      const centre = worldCentre(document, id)
      if (!centre) continue
      const current = angleOf(document.worldTransform(id))
      rotateNodes(document, [id], angle - current, centre)
    }
  })
}

const IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
