import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  angleOf,
  createFrame,
  createRectangle,
  degrees,
  multiply,
  radians,
  rotation,
  scaling,
  translation,
  type NodeId,
} from '@canvas/document'
import {
  applyRotation,
  dragRotationDelta,
  rotateNodes,
  rotateTargetsFor,
  setNodesAngle,
  snapDelta,
  worldCentre,
} from './rotate'

/** A 100 by 60 rectangle at the origin, so its centre is (50, 30). */
function scene() {
  const document = new SceneDocument()
  const node = document.insert(createRectangle({ size: { width: 100, height: 60 } }))
  return { document, node }
}

const worldAngle = (document: SceneDocument, id: NodeId): number =>
  degrees(angleOf(document.worldTransform(id)))

describe('rotateNodes', () => {
  it('turns a node by the delta it is given', () => {
    const { document, node } = scene()
    rotateNodes(document, [node.id], radians(30), worldCentre(document, node.id)!)
    expect(worldAngle(document, node.id)).toBeCloseTo(30, 6)
  })

  it('adds to whatever angle the node already had', () => {
    const { document, node } = scene()
    const centre = worldCentre(document, node.id)!
    rotateNodes(document, [node.id], radians(30), centre)
    rotateNodes(document, [node.id], radians(45), worldCentre(document, node.id)!)
    expect(worldAngle(document, node.id)).toBeCloseTo(75, 6)
  })

  it('leaves the centre exactly where it was when turning about it', () => {
    const { document, node } = scene()
    const before = worldCentre(document, node.id)!
    rotateNodes(document, [node.id], radians(37), before)
    const after = worldCentre(document, node.id)!
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('swings a node around a point that is not its own centre', () => {
    const { document, node } = scene()
    // A quarter turn about the world origin sends the centre (50,30) to (-30,50).
    rotateNodes(document, [node.id], radians(90), { x: 0, y: 0 })
    const centre = worldCentre(document, node.id)!
    expect(centre.x).toBeCloseTo(-30, 6)
    expect(centre.y).toBeCloseTo(50, 6)
  })

  it('holds up inside a scaled parent, where local units are not world units', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ transform: multiply(scaling(3), translation(200, 100)) }),
    )
    const node = document.insert(
      createRectangle({ transform: translation(10, 10), size: { width: 20, height: 20 } }),
      frame.id,
    )
    const before = worldCentre(document, node.id)!
    rotateNodes(document, [node.id], radians(50), before)

    expect(worldAngle(document, node.id)).toBeCloseTo(50, 6)
    const after = worldCentre(document, node.id)!
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('holds up inside an already rotated parent', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ transform: rotation(radians(20)) }))
    const node = document.insert(
      createRectangle({ transform: translation(40, 0), size: { width: 20, height: 20 } }),
      frame.id,
    )
    rotateNodes(document, [node.id], radians(25), worldCentre(document, node.id)!)
    // 20 from the parent plus the 25 just applied.
    expect(worldAngle(document, node.id)).toBeCloseTo(45, 6)
  })

  it('skips a locked node', () => {
    const { document, node } = scene()
    document.update(node.id, { locked: true })
    rotateNodes(document, [node.id], radians(30), worldCentre(document, node.id)!)
    expect(worldAngle(document, node.id)).toBeCloseTo(0, 6)
  })

  it('is one undo step however many nodes moved', () => {
    const { document, node } = scene()
    const other = document.insert(createRectangle({ size: { width: 10, height: 10 } }))
    document.clearHistory()

    rotateNodes(document, [node.id, other.id], radians(30), { x: 0, y: 0 })
    document.undo()
    expect(worldAngle(document, node.id)).toBeCloseTo(0, 6)
    expect(worldAngle(document, other.id)).toBeCloseTo(0, 6)
  })

  it('does nothing at all for a zero delta', () => {
    const { document, node } = scene()
    const version = document.version
    rotateNodes(document, [node.id], 0, { x: 0, y: 0 })
    expect(document.version).toBe(version)
  })
})

describe('setNodesAngle', () => {
  it('lands on the absolute angle rather than adding to it', () => {
    const { document, node } = scene()
    setNodesAngle(document, [node.id], radians(30))
    setNodesAngle(document, [node.id], radians(30))
    expect(worldAngle(document, node.id)).toBeCloseTo(30, 6)
  })

  it('turns each node about its own centre, so a row does not swing together', () => {
    const document = new SceneDocument()
    const a = document.insert(createRectangle({ size: { width: 40, height: 40 } }))
    const b = document.insert(
      createRectangle({ transform: translation(500, 0), size: { width: 40, height: 40 } }),
    )
    const centreB = worldCentre(document, b.id)!

    setNodesAngle(document, [a.id, b.id], radians(90))

    expect(worldAngle(document, b.id)).toBeCloseTo(90, 6)
    const after = worldCentre(document, b.id)!
    expect(after.x).toBeCloseTo(centreB.x, 6)
    expect(after.y).toBeCloseTo(centreB.y, 6)
  })

  it('reads back through angleOf as the value that was set', () => {
    const { document, node } = scene()
    setNodesAngle(document, [node.id], radians(-45))
    expect(worldAngle(document, node.id)).toBeCloseTo(-45, 6)
  })
})

describe('snapDelta', () => {
  const deg = (value: number): number => degrees(value)

  it('lands a single node on an absolute step, not a step from where it started', () => {
    // Started at 10 and dragged 12 more, so 22. That snaps to 15, the nearest step on the
    // circle. Snapping the delta instead would have given 10 + 15, which is not a step.
    const start = radians(10)
    expect(deg(start + snapDelta(radians(12), start))).toBeCloseTo(15, 6)
  })

  it('snaps the delta itself when there is no single starting angle', () => {
    expect(deg(snapDelta(radians(20), null))).toBeCloseTo(15, 6)
    expect(deg(snapDelta(radians(38), null))).toBeCloseTo(45, 6)
  })

  it('rounds to the nearer step rather than always down', () => {
    expect(deg(snapDelta(radians(8), null))).toBeCloseTo(15, 6)
    expect(deg(snapDelta(radians(7), null))).toBeCloseTo(0, 6)
  })

  it('leaves an angle already on a step alone', () => {
    const start = radians(30)
    expect(snapDelta(0, start)).toBeCloseTo(0, 10)
  })
})

describe('dragRotationDelta', () => {
  const pivot = { x: 0, y: 0 }
  /** Grabbed due east of the pivot, so the start angle is 0. */
  const startAngle = 0
  const pointerAt = (angle: number) => ({
    x: Math.cos(radians(angle)),
    y: Math.sin(radians(angle)),
  })

  it('is how far the pointer travelled around, not where it landed', () => {
    // Grabbed at 40 degrees, dragged to 70: the shape turns 30, wherever the handle was.
    const grabbed = radians(40)
    const delta = dragRotationDelta(pivot, grabbed, pointerAt(70), false, null)
    expect(degrees(delta)).toBeCloseTo(30, 6)
  })

  it('does not jump on a first move that has not gone anywhere', () => {
    expect(dragRotationDelta(pivot, startAngle, pointerAt(0), false, null)).toBeCloseTo(0, 10)
  })

  it("snaps onto the node's own absolute angle while shift is held", () => {
    // The node sits at 10 degrees and the pointer has dragged 12 more. Constrained, the
    // total lands on 15, so the delta is 5.
    const nodeAngle = radians(10)
    const delta = dragRotationDelta(pivot, startAngle, pointerAt(12), true, nodeAngle)
    expect(degrees(nodeAngle + delta)).toBeCloseTo(15, 6)
  })

  it('snaps the delta itself for a group, which has no single angle', () => {
    const delta = dragRotationDelta(pivot, startAngle, pointerAt(20), true, null)
    expect(degrees(delta)).toBeCloseTo(15, 6)
  })

  it('walks the angle back down when shift arrives mid gesture', () => {
    // Free at 20 degrees, then shift is pressed with the pointer unmoved: the same pointer
    // now answers 15, which is a smaller delta than the free one.
    const free = dragRotationDelta(pivot, startAngle, pointerAt(20), false, null)
    const snapped = dragRotationDelta(pivot, startAngle, pointerAt(20), true, radians(0))
    expect(degrees(free)).toBeCloseTo(20, 6)
    expect(degrees(snapped)).toBeCloseTo(15, 6)
    expect(snapped).toBeLessThan(free)
  })
})

describe('applyRotation', () => {
  it('is absolute from the grab, so calling it twice does not turn twice', () => {
    const { document, node } = scene()
    const targets = rotateTargetsFor(document, [node.id])
    const centre = worldCentre(document, node.id)!

    applyRotation(document, targets, radians(30), centre)
    applyRotation(document, targets, radians(30), centre)
    expect(worldAngle(document, node.id)).toBeCloseTo(30, 6)
  })

  it('can walk an angle back down, which is what snapping needs', () => {
    const { document, node } = scene()
    const targets = rotateTargetsFor(document, [node.id])
    const centre = worldCentre(document, node.id)!

    applyRotation(document, targets, radians(80), centre)
    applyRotation(document, targets, radians(45), centre)
    expect(worldAngle(document, node.id)).toBeCloseTo(45, 6)
  })

  it('swings a multiple selection about one shared pivot', () => {
    const document = new SceneDocument()
    const a = document.insert(createRectangle({ size: { width: 40, height: 40 } }))
    const b = document.insert(
      createRectangle({ transform: translation(100, 0), size: { width: 40, height: 40 } }),
    )
    const targets = rotateTargetsFor(document, [a.id, b.id])
    // Midway between the two centres.
    const pivot = { x: 70, y: 20 }

    applyRotation(document, targets, radians(180), pivot)

    // A half turn about the midpoint swaps where the two sit.
    const centreA = worldCentre(document, a.id)!
    expect(centreA.x).toBeCloseTo(120, 6)
    expect(centreA.y).toBeCloseTo(20, 6)
  })

  it('leaves a locked node out of the targets entirely', () => {
    const { document, node } = scene()
    document.update(node.id, { locked: true })
    expect(rotateTargetsFor(document, [node.id])).toHaveLength(0)
  })
})
