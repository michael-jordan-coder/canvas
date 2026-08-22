import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createFrame,
  createRectangle,
  defaultFrameLayout,
  translation,
  type FrameLayout,
} from '@figma-canvas/document'
import {
  addAutoLayout,
  relayout,
  removeAutoLayout,
  updateFrameLayout,
  updateLayoutChild,
} from './autoLayout'

function layout(overrides: Partial<FrameLayout> = {}): FrameLayout {
  return {
    ...defaultFrameLayout('horizontal'),
    gap: 10,
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
    ...overrides,
  }
}

function row() {
  const scene = new SceneDocument()
  const frame = scene.insert(
    createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
  )
  const a = scene.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
  const b = scene.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
  relayout(scene, [frame.id])
  scene.clearHistory()
  return { scene, frame, a, b }
}

describe('relayout', () => {
  it('folds the edit and the layout it forces into one undo step', () => {
    const { scene, frame, a, b } = row()

    scene.transact(() => {
      scene.update(a.id, { size: { width: 90, height: 50 } })
      relayout(scene, [a.id])
    })
    expect(scene.expectNode(b.id).transform.tx).toBe(110)

    scene.undo()
    expect(scene.expectNode(a.id).size.width).toBe(50)
    expect(scene.expectNode(b.id).transform.tx).toBe(70)
    expect(scene.canUndo).toBe(false)

    scene.redo()
    expect(scene.expectNode(b.id).transform.tx).toBe(110)
    void frame
  })

  it('writes nothing into a settled document', () => {
    const { scene, frame } = row()
    const before = scene.version
    relayout(scene, [frame.id])
    expect(scene.version).toBe(before)
    expect(scene.canUndo).toBe(false)
  })

  it('reaches through a nested hug chain from the innermost edit', () => {
    const scene = new SceneDocument()
    const outer = scene.insert(
      createFrame({
        size: { width: 1, height: 1 },
        layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }),
      }),
    )
    const inner = scene.insert(
      createFrame({
        size: { width: 1, height: 1 },
        layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }),
      }),
      outer.id,
    )
    const leaf = scene.insert(createRectangle({ size: { width: 50, height: 30 } }), inner.id)
    relayout(scene, [outer.id])

    scene.transact(() => {
      scene.update(leaf.id, { size: { width: 100, height: 30 } })
      relayout(scene, [leaf.id])
    })
    expect(scene.expectNode(inner.id).size.width).toBe(120)
    expect(scene.expectNode(outer.id).size.width).toBe(140)
  })

  it('is free for a document with no auto layout in it', () => {
    const scene = new SceneDocument()
    const rect = scene.insert(createRectangle({ size: { width: 50, height: 50 } }))
    const before = scene.version
    relayout(scene, [rect.id])
    expect(scene.version).toBe(before)
  })
})

describe('addAutoLayout', () => {
  it('reads the layout off the children and moves nothing, in one undo step', () => {
    const scene = new SceneDocument()
    const frame = scene.insert(createFrame({ size: { width: 200, height: 100 } }))
    const left = scene.insert(
      createRectangle({ size: { width: 50, height: 50 }, transform: translation(10, 10) }),
      frame.id,
    )
    const right = scene.insert(
      createRectangle({ size: { width: 60, height: 50 }, transform: translation(70, 10) }),
      frame.id,
    )
    scene.clearHistory()

    const version = scene.version
    addAutoLayout(scene, frame.id)

    const enabled = scene.expectNode(frame.id)
    expect(enabled.type === 'frame' && enabled.layout?.direction).toBe('horizontal')
    expect(scene.expectNode(left.id).transform.tx).toBe(10)
    expect(scene.expectNode(right.id).transform.tx).toBe(70)
    expect(scene.expectNode(frame.id).size).toEqual({ width: 200, height: 100 })
    expect(scene.version).toBe(version + 1)

    scene.undo()
    const disabled = scene.expectNode(frame.id)
    expect(disabled.type === 'frame' && disabled.layout).toBeUndefined()
    expect(scene.canUndo).toBe(false)
  })

  it('leaves the children where the layout put them when removed', () => {
    const { scene, frame, a, b } = row()
    removeAutoLayout(scene, frame.id)

    const off = scene.expectNode(frame.id)
    expect(off.type === 'frame' && off.layout).toBeUndefined()
    expect(scene.expectNode(a.id).transform.tx).toBe(10)
    expect(scene.expectNode(b.id).transform.tx).toBe(70)
  })
})

describe('panel commands', () => {
  it('updateFrameLayout relayouts in the same step', () => {
    const { scene, b } = row()
    const frameNode = scene.getChildren(scene.rootId)[0]
    if (!frameNode) throw new Error('expected the frame')

    updateFrameLayout(scene, frameNode.id, { gap: 30 })
    expect(scene.expectNode(b.id).transform.tx).toBe(90)

    scene.undo()
    expect(scene.expectNode(b.id).transform.tx).toBe(70)
  })

  it('fill on a hug axis of a nested frame flips that axis to fixed', () => {
    const scene = new SceneDocument()
    const outer = scene.insert(
      createFrame({ size: { width: 300, height: 100 }, layout: layout() }),
    )
    const inner = scene.insert(
      createFrame({
        size: { width: 50, height: 50 },
        layout: layout({ mainSizing: 'hug', crossSizing: 'hug' }),
      }),
      outer.id,
    )
    relayout(scene, [outer.id])

    updateLayoutChild(scene, scene.expectNode(inner.id), { widthMode: 'fill' })

    const after = scene.expectNode(inner.id)
    if (after.type !== 'frame' || !after.layout) throw new Error('expected the layout')
    expect(after.layout.mainSizing).toBe('fixed')
    // 300 wide, 20 padding, the only child fills the rest.
    expect(after.size.width).toBe(280)
  })
})
