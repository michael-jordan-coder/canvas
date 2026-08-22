import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createFrame,
  createRectangle,
  defaultFrameLayout,
  translation,
  type NodeId,
  type Rect,
} from '@figma-canvas/document'
import { alignSelection } from './align'
import { relayout } from './autoLayout'

/** Three rectangles at the root, spread on both axes so every command has something to do. */
function stack() {
  const scene = new SceneDocument()
  const a = scene.insert(
    createRectangle({ name: 'a', transform: translation(0, 0), size: { width: 10, height: 10 } }),
  )
  const b = scene.insert(
    createRectangle({ name: 'b', transform: translation(20, 30), size: { width: 10, height: 20 } }),
  )
  const c = scene.insert(
    createRectangle({ name: 'c', transform: translation(50, 5), size: { width: 10, height: 10 } }),
  )
  scene.clearHistory()
  return { scene, a, b, c }
}

/** The root is unrotated and unscaled, so local tx/ty equal world position directly. */
const boxOf = (scene: SceneDocument, id: NodeId): Rect => {
  const node = scene.expectNode(id)
  return { x: node.transform.tx, y: node.transform.ty, ...node.size }
}

describe('alignSelection', () => {
  it('aligns left, to the union of the selection', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'left')
    expect([a, b, c].map((n) => boxOf(scene, n.id).x)).toEqual([0, 0, 0])
  })

  it('centers on x, to the union of the selection', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'centerX')
    // Union spans 0 to 60, so its centre is 30; every 10 wide box centres there at x = 25.
    expect([a, b, c].map((n) => boxOf(scene, n.id).x)).toEqual([25, 25, 25])
  })

  it('aligns right, to the union of the selection', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'right')
    // Union's right edge is 60, so every 10 wide box lands at x = 50.
    expect([a, b, c].map((n) => boxOf(scene, n.id).x)).toEqual([50, 50, 50])
  })

  it('aligns top, to the union of the selection', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'top')
    expect([a, b, c].map((n) => boxOf(scene, n.id).y)).toEqual([0, 0, 0])
  })

  it('centers on y, to the union of the selection', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'centerY')
    // Union spans 0 to 50, so its centre is 25.
    expect(boxOf(scene, a.id).y).toBe(20) // 10 tall, centres at 25
    expect(boxOf(scene, b.id).y).toBe(15) // 20 tall, centres at 25
    expect(boxOf(scene, c.id).y).toBe(20) // 10 tall, centres at 25
  })

  it('aligns bottom, to the union of the selection', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'bottom')
    // Union's bottom edge is 50.
    expect(boxOf(scene, a.id).y).toBe(40)
    expect(boxOf(scene, b.id).y).toBe(30) // already there
    expect(boxOf(scene, c.id).y).toBe(40)
  })

  it('distributes horizontal gaps evenly, holding the two extremes fixed', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'distributeHorizontal')
    // a (0-10) and c (50-60) anchor the span; b's 10 wide box centres the leftover gap.
    expect(boxOf(scene, a.id).x).toBe(0)
    expect(boxOf(scene, b.id).x).toBe(25)
    expect(boxOf(scene, c.id).x).toBe(50)
  })

  it('distributes vertical gaps evenly, holding the two extremes fixed', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'distributeVertical')
    // Sorted by y: a (0-10), c (5-15), b (30-50). a and b anchor the span.
    expect(boxOf(scene, a.id).y).toBe(0)
    expect(boxOf(scene, c.id).y).toBe(15)
    expect(boxOf(scene, b.id).y).toBe(30)
  })

  it('does nothing to distribute with fewer than three nodes', () => {
    const { scene, a, b } = stack()
    const before = scene.version
    alignSelection(scene, [a.id, b.id], 'distributeHorizontal')
    expect(scene.version).toBe(before)
  })

  it('aligns a single node to its parent frame, not to its own bounds', () => {
    const scene = new SceneDocument()
    const frame = scene.insert(
      createFrame({ transform: translation(100, 50), size: { width: 200, height: 100 } }),
    )
    const child = scene.insert(
      createRectangle({ transform: translation(60, 60), size: { width: 20, height: 20 } }),
      frame.id,
    )
    scene.clearHistory()

    alignSelection(scene, [child.id], 'right')
    // The frame's world right edge is 300; mapped back through the frame's own transform,
    // the child's local x lands at 200 - 20.
    expect(scene.expectNode(child.id).transform.tx).toBe(180)
  })

  it('leaves a lone top level node alone, since the page has no bounds to align it to', () => {
    const scene = new SceneDocument()
    const rect = scene.insert(
      createRectangle({ transform: translation(40, 40), size: { width: 10, height: 10 } }),
    )
    scene.clearHistory()
    const before = scene.version

    alignSelection(scene, [rect.id], 'centerX')
    expect(scene.version).toBe(before)
  })

  it('skips a locked node but still counts it in the union', () => {
    const { scene, a, b, c } = stack()
    scene.update(b.id, { locked: true })

    alignSelection(scene, [a.id, b.id, c.id], 'left')
    // b never moves.
    expect(boxOf(scene, b.id).x).toBe(20)
    // a and c still align to the union that includes b's untouched box.
    expect(boxOf(scene, a.id).x).toBe(0)
    expect(boxOf(scene, c.id).x).toBe(0)
  })

  it('leaves an auto layout child alone, since the layout owns its position', () => {
    const scene = new SceneDocument()
    const frame = scene.insert(
      createFrame({
        size: { width: 300, height: 100 },
        layout: { ...defaultFrameLayout('horizontal'), gap: 10 },
      }),
    )
    const child = scene.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    relayout(scene, [frame.id])
    scene.clearHistory()
    const before = scene.expectNode(child.id).transform

    alignSelection(scene, [child.id], 'top')
    expect(scene.expectNode(child.id).transform).toEqual(before)
  })

  it('is one undo step for the whole selection', () => {
    const { scene, a, b, c } = stack()
    alignSelection(scene, [a.id, b.id, c.id], 'left')
    expect(scene.historyDepth).toBe(1)

    scene.undo()
    expect(boxOf(scene, a.id).x).toBe(0)
    expect(boxOf(scene, b.id).x).toBe(20)
    expect(boxOf(scene, c.id).x).toBe(50)
  })
})
