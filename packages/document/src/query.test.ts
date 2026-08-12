import { beforeEach, describe, expect, it } from 'vitest'
import { SceneDocument } from './document.js'
import { containerAt, nodesIn } from './hit.js'
import { translation } from './math.js'
import { createEllipse, createFrame, createRectangle } from './node.js'

/**
 * A frame spanning (0,0) to (200,200) holding a rectangle at (20,20) sized 60x60, plus a
 * loose ellipse out at (400,0) sized 50x50.
 */
function scene() {
  const document = new SceneDocument()
  const frame = document.insert(
    createFrame({ name: 'F', size: { width: 200, height: 200 } }),
  )
  const inner = document.insert(
    createRectangle({ name: 'inner', transform: translation(20, 20), size: { width: 60, height: 60 } }),
    frame.id,
  )
  const loose = document.insert(
    createEllipse({ name: 'loose', transform: translation(400, 0), size: { width: 50, height: 50 } }),
  )
  return { document, frame, inner, loose }
}

let world: ReturnType<typeof scene>
beforeEach(() => {
  world = scene()
})

describe('containerAt', () => {
  it('returns the frame a point falls inside', () => {
    expect(containerAt(world.document, { x: 100, y: 100 }).id).toBe(world.frame.id)
  })

  it('returns the page outside every frame', () => {
    expect(containerAt(world.document, { x: 900, y: 900 }).id).toBe(world.document.rootId)
  })

  it('ignores shapes, since they cannot hold children', () => {
    // Over the inner rectangle, but a rectangle is not a container.
    expect(containerAt(world.document, { x: 40, y: 40 }).id).toBe(world.frame.id)
  })

  it('will not put a shape inside a locked or hidden frame', () => {
    world.document.update(world.frame.id, { locked: true })
    expect(containerAt(world.document, { x: 100, y: 100 }).id).toBe(world.document.rootId)

    world.document.update(world.frame.id, { locked: false, visible: false })
    expect(containerAt(world.document, { x: 100, y: 100 }).id).toBe(world.document.rootId)
  })

  it('picks the innermost of nested frames', () => {
    const nested = world.document.insert(
      createFrame({ transform: translation(10, 10), size: { width: 100, height: 100 } }),
      world.frame.id,
    )
    expect(containerAt(world.document, { x: 50, y: 50 }).id).toBe(nested.id)
  })
})

describe('nodesIn', () => {
  const names = (rect: Parameters<typeof nodesIn>[1]): string[] =>
    nodesIn(world.document, rect).map((node) => node.name)

  it('catches a shape it merely touches', () => {
    // Clipping the corner of the loose ellipse only.
    expect(names({ x: 380, y: -20, width: 40, height: 40 })).toEqual(['loose'])
  })

  it('catches a frame only when it swallows it whole', () => {
    expect(names({ x: -50, y: -50, width: 400, height: 400 })).toEqual(['F'])
  })

  it('reaches inside a frame it only partly covers', () => {
    // Overlapping the frame's top left, where the inner rectangle sits.
    expect(names({ x: -10, y: -10, width: 60, height: 60 })).toEqual(['inner'])
  })

  it('returns nothing over empty space', () => {
    expect(names({ x: 1000, y: 1000, width: 10, height: 10 })).toEqual([])
  })

  it('catches several nodes at once', () => {
    expect(names({ x: -50, y: -50, width: 600, height: 600 }).sort()).toEqual(['F', 'loose'])
  })

  it('skips hidden and locked nodes', () => {
    world.document.update(world.loose.id, { visible: false })
    expect(names({ x: 380, y: -20, width: 40, height: 40 })).toEqual([])

    world.document.update(world.loose.id, { visible: true, locked: true })
    expect(names({ x: 380, y: -20, width: 40, height: 40 })).toEqual([])
  })

  it('accounts for a scaled parent when testing children', () => {
    const document = new SceneDocument()
    const parent = document.insert(
      createFrame({
        transform: { a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 },
        size: { width: 500, height: 500 },
      }),
    )
    document.insert(
      createRectangle({ name: 'scaled', transform: translation(10, 10), size: { width: 20, height: 20 } }),
      parent.id,
    )
    // The child covers world 20..60. A marquee at 100..120 must not catch it.
    expect(nodesIn(document, { x: 100, y: 100, width: 20, height: 20 })).toEqual([])
    expect(nodesIn(document, { x: 30, y: 30, width: 10, height: 10 }).map((n) => n.name)).toEqual([
      'scaled',
    ])
  })
})
