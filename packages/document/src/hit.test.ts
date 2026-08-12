import { beforeEach, describe, expect, it } from 'vitest'
import { SceneDocument } from './document.js'
import { hitTest } from './hit.js'
import { translation } from './math.js'
import { createEllipse, createFrame, createRectangle, type SceneNode } from './node.js'
import { fromHex } from './paint.js'

/**
 * Rectangle spans (-136,-96) to (4,-6) in world space, the ellipse is centred at (55,55)
 * with a radius of 45, and both sit inside a frame spanning (-160,-120) to (160,120).
 */
function scene() {
  const document = new SceneDocument()
  const frame = document.insert(
    createFrame({
      name: 'Frame 1',
      transform: translation(-160, -120),
      size: { width: 320, height: 240 },
      fills: [fromHex('#ffffff')],
    }),
  )
  const rectangle = document.insert(
    createRectangle({
      name: 'Rectangle',
      transform: translation(24, 24),
      size: { width: 140, height: 90 },
      cornerRadius: 4,
    }),
    frame.id,
  )
  const ellipse = document.insert(
    createEllipse({
      name: 'Ellipse',
      transform: translation(170, 130),
      size: { width: 90, height: 90 },
    }),
    frame.id,
  )
  return { document, frame, rectangle, ellipse }
}

let world: ReturnType<typeof scene>
beforeEach(() => {
  world = scene()
})

const nameAt = (x: number, y: number): string =>
  hitTest(world.document, { x, y })?.name ?? 'nothing'

describe('hitTest', () => {
  it('finds the shape under the point', () => {
    expect(nameAt(-100, -50)).toBe('Rectangle')
    expect(nameAt(55, 55)).toBe('Ellipse')
  })

  it('falls through to the frame between its children', () => {
    expect(nameAt(-150, 100)).toBe('Frame 1')
  })

  it('returns nothing outside everything', () => {
    expect(nameAt(500, 500)).toBe('nothing')
  })

  it('respects the ellipse rather than its bounding box', () => {
    // (12,12) is inside the ellipse's box but 60 units from a centre with radius 45.
    expect(nameAt(12, 12)).toBe('Frame 1')
  })

  it('takes the corner radius out of the clickable area', () => {
    // The rectangle's top left corner is (-136,-96) with a radius of 4.
    expect(nameAt(-135.5, -95.5)).toBe('Frame 1')
    expect(nameAt(-134, -94)).toBe('Rectangle')
  })

  it('prefers whatever was painted most recently', () => {
    const { document, frame } = world
    document.insert(
      createRectangle({
        name: 'On top',
        transform: translation(24, 24),
        size: { width: 140, height: 90 },
      }),
      frame.id,
    )
    expect(nameAt(-100, -50)).toBe('On top')
  })

  it('skips hidden nodes', () => {
    world.document.update(world.rectangle.id, { visible: false })
    expect(nameAt(-100, -50)).toBe('Frame 1')
  })

  it('lets a click pass through a locked node', () => {
    world.document.update(world.rectangle.id, { locked: true })
    expect(nameAt(-100, -50)).toBe('Frame 1')
  })

  it('hides children along with their parent', () => {
    world.document.update(world.frame.id, { visible: false })
    expect(nameAt(55, 55)).toBe('nothing')
  })
})

describe('containment through transforms', () => {
  it('tests in the node own space, so a scaled parent still hits correctly', () => {
    const document = new SceneDocument()
    const parent = document.insert(
      createFrame({ transform: { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 0 } }),
    )
    const child: SceneNode = document.insert(
      createRectangle({
        name: 'Scaled',
        transform: translation(10, 5),
        size: { width: 20, height: 20 },
      }),
      parent.id,
    )
    // The child covers local 10..30, which is world 120..160 after the parent's 2x.
    expect(hitTest(document, { x: 130, y: 20 })?.id).toBe(child.id)
    expect(hitTest(document, { x: 118, y: 20 })?.id).not.toBe(child.id)
  })
})
