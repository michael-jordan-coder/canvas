import { describe, expect, it } from 'vitest'
import { SceneDocument } from './document.js'
import { applyToPoint, multiply, scaling, translation } from './math.js'
import { createFrame, createRectangle } from './node.js'

describe('worldTransform', () => {
  it('applies a node own transform inside its parent', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ transform: translation(-160, -120) }))
    const child = document.insert(createRectangle({ transform: translation(24, 24) }), frame.id)

    const world = document.worldTransform(child.id)
    expect(world.tx).toBe(-136)
    expect(world.ty).toBe(-96)
  })

  it('scales a child offset by its parent scale', () => {
    const document = new SceneDocument()
    const parent = document.insert(
      createFrame({ transform: multiply(scaling(2), translation(100, 0)) }),
    )
    const child = document.insert(createRectangle({ transform: translation(10, 5) }), parent.id)

    const world = document.worldTransform(child.id)
    expect(world.tx).toBe(120)
    expect(world.ty).toBe(10)
    expect(world.a).toBe(2)
    // A point 30 into the child is 60 further along in the world.
    expect(applyToPoint(world, { x: 30, y: 0 }).x).toBe(180)
  })
})

describe('notification', () => {
  it('wakes subscribers once per transaction, not once per edit', () => {
    const document = new SceneDocument()
    const a = document.insert(createRectangle({}))
    const b = document.insert(createRectangle({}))

    let calls = 0
    document.subscribe(() => {
      calls += 1
    })

    document.transact(() => {
      document.update(a.id, { name: 'a' })
      document.update(b.id, { name: 'b' })
    })
    expect(calls).toBe(1)
  })

  it('reports which nodes changed and whether the change was structural', () => {
    const document = new SceneDocument()
    const rectangle = document.insert(createRectangle({}))

    const seen: Array<{ ids: string[]; structural: boolean }> = []
    document.subscribe((change) => {
      seen.push({ ids: [...change.changed], structural: change.structural })
    })

    document.update(rectangle.id, { name: 'renamed' })
    expect(seen[0]?.ids).toEqual([rectangle.id])
    expect(seen[0]?.structural).toBe(false)

    document.remove(rectangle.id)
    expect(seen[1]?.structural).toBe(true)
  })

  it('bumps the version on every committed change', () => {
    const document = new SceneDocument()
    const before = document.version
    document.insert(createRectangle({}))
    expect(document.version).toBeGreaterThan(before)
  })
})

describe('structure', () => {
  it('removes a subtree entirely', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({}))
    document.insert(createRectangle({}), frame.id)
    document.insert(createRectangle({}), frame.id)
    expect(document.size).toBe(4)

    document.remove(frame.id)
    expect(document.size).toBe(1)
    expect(document.getChildren(document.rootId)).toEqual([])
  })

  it('refuses to hold children on a node that cannot', () => {
    const document = new SceneDocument()
    const rectangle = document.insert(createRectangle({}))
    expect(() => document.insert(createRectangle({}), rectangle.id)).toThrow(/cannot hold children/)
  })

  it('walks back to front, which is the order shapes are drawn in', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ name: 'frame' }))
    document.insert(createRectangle({ name: 'first' }), frame.id)
    document.insert(createRectangle({ name: 'second' }), frame.id)

    expect([...document.walk()].map((node) => node.name)).toEqual([
      'Page 1',
      'frame',
      'first',
      'second',
    ])
  })
})
