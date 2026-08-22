import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createFrame,
  createRectangle,
  multiply,
  radians,
  rotation,
  scaling,
  transformRect,
  translation,
  type NodeId,
  type Rect,
} from '@figma-canvas/document'
import { flipNodes } from './flip'

const worldBox = (document: SceneDocument, id: NodeId): Rect => {
  const node = document.expectNode(id)
  return transformRect(document.worldTransform(id), { x: 0, y: 0, ...node.size })
}

function scene() {
  const document = new SceneDocument()
  const node = document.insert(
    createRectangle({ transform: translation(30, 10), size: { width: 20, height: 40 } }),
  )
  return { document, node }
}

describe('flipNodes', () => {
  it('is its own inverse', () => {
    const { document, node } = scene()
    const before = { ...document.expectNode(node.id).transform }

    flipNodes(document, [node.id], 'horizontal')
    flipNodes(document, [node.id], 'horizontal')

    const after = document.expectNode(node.id).transform
    expect(after.a).toBeCloseTo(before.a, 10)
    expect(after.b).toBeCloseTo(before.b, 10)
    expect(after.c).toBeCloseTo(before.c, 10)
    expect(after.d).toBeCloseTo(before.d, 10)
    expect(after.tx).toBeCloseTo(before.tx, 10)
    expect(after.ty).toBeCloseTo(before.ty, 10)
  })

  it('leaves a single node\'s world bounds exactly where they were', () => {
    const { document, node } = scene()
    const before = worldBox(document, node.id)

    flipNodes(document, [node.id], 'vertical')

    const after = worldBox(document, node.id)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
    expect(after.width).toBeCloseTo(before.width, 10)
    expect(after.height).toBeCloseTo(before.height, 10)
  })

  it('holds up inside a rotated and non-uniformly scaled parent', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ transform: multiply(scaling(2, 1), rotation(radians(15))) }),
    )
    const node = document.insert(
      createRectangle({ transform: translation(40, 5), size: { width: 20, height: 10 } }),
      frame.id,
    )
    const before = worldBox(document, node.id)

    flipNodes(document, [node.id], 'vertical')

    // A node inside a parent whose axes are not the world's still mirrors about its own
    // world-space centre, so its world bounds do not move even though its local transform
    // (composed back through the parent's rotation and scale) changes a great deal.
    const after = worldBox(document, node.id)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(after.width).toBeCloseTo(before.width, 6)
    expect(after.height).toBeCloseTo(before.height, 6)
  })

  it('flips a group about its shared centre, swapping the two rather than each in place', () => {
    const document = new SceneDocument()
    const a = document.insert(
      createRectangle({ transform: translation(0, 0), size: { width: 10, height: 10 } }),
    )
    const b = document.insert(
      createRectangle({ transform: translation(100, 0), size: { width: 10, height: 10 } }),
    )

    flipNodes(document, [a.id, b.id], 'horizontal')

    // The shared centre sits at x = 55. Mirroring about it swaps the two boxes rather than
    // reflecting each one inside its own unchanged footprint, which is what "in place" would
    // have left behind for a symmetric rectangle.
    expect(worldBox(document, a.id).x).toBeCloseTo(100, 10)
    expect(worldBox(document, b.id).x).toBeCloseTo(0, 10)
  })

  it('skips a locked node but still uses it when computing the shared centre', () => {
    const document = new SceneDocument()
    const a = document.insert(
      createRectangle({ transform: translation(0, 0), size: { width: 10, height: 10 } }),
    )
    const b = document.insert(
      createRectangle({ transform: translation(100, 0), size: { width: 10, height: 10 } }),
    )
    document.update(a.id, { locked: true })
    const lockedBefore = { ...document.expectNode(a.id).transform }

    flipNodes(document, [a.id, b.id], 'horizontal')

    expect(document.expectNode(a.id).transform).toEqual(lockedBefore)
    // The pivot is still the pair's shared centre at x = 55, locked node included, so b
    // still swaps all the way across rather than mirroring about a centre of just itself.
    expect(worldBox(document, b.id).x).toBeCloseTo(0, 10)
  })

  it('is one undo step however many nodes flipped', () => {
    const document = new SceneDocument()
    const a = document.insert(
      createRectangle({ transform: translation(0, 0), size: { width: 10, height: 10 } }),
    )
    const b = document.insert(
      createRectangle({ transform: translation(100, 0), size: { width: 10, height: 10 } }),
    )
    document.clearHistory()

    flipNodes(document, [a.id, b.id], 'horizontal')
    expect(document.historyDepth).toBe(1)

    document.undo()
    expect(worldBox(document, a.id).x).toBeCloseTo(0, 10)
    expect(worldBox(document, b.id).x).toBeCloseTo(100, 10)
  })

  it('does nothing for an empty selection', () => {
    const { document } = scene()
    const version = document.version
    flipNodes(document, [], 'horizontal')
    expect(document.version).toBe(version)
  })
})
