import { describe, expect, it } from 'vitest'
import { SceneDocument } from './document.js'
import { applyToPoint, multiply, scaling, translation } from './math.js'
import { createFrame, createRectangle } from './node.js'

function stack() {
  const document = new SceneDocument()
  const a = document.insert(createRectangle({ name: 'a' }))
  const b = document.insert(createRectangle({ name: 'b' }))
  const c = document.insert(createRectangle({ name: 'c' }))
  document.clearHistory()
  return { document, a, b, c }
}

const order = (document: SceneDocument): string[] =>
  document.getChildren(document.rootId).map((node) => node.name)

describe('reorder', () => {
  it('moves a node one place towards the front', () => {
    const { document, a } = stack()
    document.reorder(a.id, document.indexOf(a.id) + 1)
    expect(order(document)).toEqual(['b', 'a', 'c'])
  })

  it('clamps rather than falling off either end', () => {
    const { document, a, c } = stack()
    document.reorder(a.id, -5)
    expect(order(document)).toEqual(['a', 'b', 'c'])
    document.reorder(c.id, 99)
    expect(order(document)).toEqual(['a', 'b', 'c'])
  })

  it('sends a node to the back', () => {
    const { document, c } = stack()
    document.reorder(c.id, 0)
    expect(order(document)).toEqual(['c', 'a', 'b'])
  })

  it('is one undo step', () => {
    const { document, a } = stack()
    document.reorder(a.id, 2)
    expect(document.historyDepth).toBe(1)
    document.undo()
    expect(order(document)).toEqual(['a', 'b', 'c'])
  })
})

describe('reparent', () => {
  it('moves a node between parents', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ size: { width: 200, height: 200 } }))
    const loose = document.insert(createRectangle({ name: 'loose' }))
    document.clearHistory()

    document.reparent(loose.id, frame.id)
    expect(document.getChildren(frame.id).map((node) => node.name)).toEqual(['loose'])
    expect(document.getChildren(document.rootId)).toHaveLength(1)
    expect(document.expectNode(loose.id).parent).toBe(frame.id)
  })

  it('leaves the node exactly where it appeared to be', () => {
    const document = new SceneDocument()
    // A frame at (100,0) scaled 2x, so its space is very different from the page's.
    const frame = document.insert(
      createFrame({ transform: multiply(scaling(2), translation(100, 0)) }),
    )
    const loose = document.insert(
      createRectangle({ transform: translation(300, 60), size: { width: 40, height: 40 } }),
    )
    const before = document.worldTransform(loose.id)

    document.reparent(loose.id, frame.id)
    const after = document.worldTransform(loose.id)

    // Same place in the world, despite a completely different local transform.
    expect(after.tx).toBeCloseTo(before.tx, 9)
    expect(after.ty).toBeCloseTo(before.ty, 9)
    expect(applyToPoint(after, { x: 10, y: 10 })).toEqual(applyToPoint(before, { x: 10, y: 10 }))
    // The stored transform really did change, so this is not passing by accident.
    expect(document.expectNode(loose.id).transform.tx).not.toBeCloseTo(300, 3)
  })

  it('refuses to put a node inside itself', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({}))
    document.reparent(frame.id, frame.id)
    expect(document.expectNode(frame.id).parent).toBe(document.rootId)
  })

  it('refuses to put a node inside its own descendant, which would leak the subtree', () => {
    const document = new SceneDocument()
    const outer = document.insert(createFrame({ name: 'outer' }))
    const inner = document.insert(createFrame({ name: 'inner' }), outer.id)

    document.reparent(outer.id, inner.id)
    expect(document.expectNode(outer.id).parent).toBe(document.rootId)
    expect(document.getChildren(outer.id).map((node) => node.name)).toEqual(['inner'])
  })

  it('refuses a parent that cannot hold children', () => {
    const document = new SceneDocument()
    const rectangle = document.insert(createRectangle({}))
    const other = document.insert(createRectangle({}))
    document.reparent(other.id, rectangle.id)
    expect(document.expectNode(other.id).parent).toBe(document.rootId)
  })

  it('honours the index it is given', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({}))
    document.insert(createRectangle({ name: 'first' }), frame.id)
    document.insert(createRectangle({ name: 'second' }), frame.id)
    const loose = document.insert(createRectangle({ name: 'loose' }))

    document.reparent(loose.id, frame.id, 1)
    expect(document.getChildren(frame.id).map((node) => node.name)).toEqual([
      'first',
      'loose',
      'second',
    ])
  })

  it('is one undo step that restores both parents', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({}))
    const loose = document.insert(createRectangle({ name: 'loose', transform: translation(9, 9) }))
    document.clearHistory()

    document.reparent(loose.id, frame.id)
    expect(document.historyDepth).toBe(1)

    document.undo()
    expect(document.expectNode(loose.id).parent).toBe(document.rootId)
    expect(document.getChildren(frame.id)).toEqual([])
    expect(document.expectNode(loose.id).transform.tx).toBe(9)
  })
})
