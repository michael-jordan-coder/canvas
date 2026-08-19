import { beforeEach, describe, expect, it } from 'vitest'
import { SceneDocument } from './document.js'
import { hitTest, nodesIn } from './hit.js'
import { translation } from './math.js'
import {
  createEllipse,
  createFrame,
  createRectangle,
  createText,
  type FrameNode,
  type SceneNode,
} from './node.js'
import { fromHex, type Stroke, type StrokeAlign } from './paint.js'

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
    // Big enough to hold the child. A frame clips by default, and a frame with no size
    // clips everything away.
    const parent = document.insert(
      createFrame({
        transform: { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 0 },
        size: { width: 100, height: 100 },
      }),
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

describe('strokes and what you can click', () => {
  function withStroke(align: StrokeAlign) {
    const document = new SceneDocument()
    const rectangle = document.insert(
      createRectangle({
        size: { width: 100, height: 60 },
        strokes: [{ paint: fromHex('#ff0000'), weight: 10, align }],
      }),
    )
    return { document, rectangle }
  }

  it('reaches out to an outside stroke, because that is drawn and can be seen', () => {
    const { document, rectangle } = withStroke('outside')
    // 6 past the right edge, inside the 10 wide band that sits entirely outside it.
    expect(hitTest(document, { x: 106, y: 30 })?.id).toBe(rectangle.id)
    expect(hitTest(document, { x: 112, y: 30 })).toBeNull()
  })

  it('grows by half a weight for a centred stroke', () => {
    const { document, rectangle } = withStroke('center')
    expect(hitTest(document, { x: 103, y: 30 })?.id).toBe(rectangle.id)
    expect(hitTest(document, { x: 107, y: 30 })).toBeNull()
  })

  it('leaves the footprint alone for an inside stroke', () => {
    const { document, rectangle } = withStroke('inside')
    expect(hitTest(document, { x: 99, y: 30 })?.id).toBe(rectangle.id)
    expect(hitTest(document, { x: 101, y: 30 })).toBeNull()
  })

  it('widens the corner arc with the stroke rather than squaring it off', () => {
    const document = new SceneDocument()
    const rounded = document.insert(
      createRectangle({
        size: { width: 100, height: 100 },
        cornerRadius: 20,
        strokes: [{ paint: fromHex('#ff0000'), weight: 20, align: 'outside' }],
      }),
    )
    // The outer corner is an arc of radius 40 centred at (20,20), so the diagonal reaches
    // 20 + 40/sqrt(2) = 48.3 from the centre. A squared off corner would have reached -20,-20.
    const inside = 20 - 40 / Math.SQRT2 + 0.5
    expect(hitTest(document, { x: inside, y: inside })?.id).toBe(rounded.id)
    expect(hitTest(document, { x: -19, y: -19 })).toBeNull()
  })

  it('reaches out to an outside stroke on an ellipse too', () => {
    const document = new SceneDocument()
    const ellipse = document.insert(
      createEllipse({
        size: { width: 100, height: 100 },
        strokes: [{ paint: fromHex('#ff0000'), weight: 10, align: 'outside' }],
      }),
    )
    expect(hitTest(document, { x: 106, y: 50 })?.id).toBe(ellipse.id)
    expect(hitTest(document, { x: 112, y: 50 })).toBeNull()
  })

  it('ignores a stroke with no weight', () => {
    const document = new SceneDocument()
    document.insert(
      createRectangle({
        size: { width: 100, height: 60 },
        strokes: [{ paint: fromHex('#ff0000'), weight: 0, align: 'outside' }],
      }),
    )
    expect(hitTest(document, { x: 104, y: 30 })).toBeNull()
  })
})

describe('clipsContent', () => {
  /** A 100 square frame with a child hanging 80 past its right edge. */
  function clipped(clipsContent: boolean) {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 100, height: 100 }, clipsContent }),
    )
    const child = document.insert(
      createRectangle({ transform: translation(60, 40), size: { width: 80, height: 20 } }),
      frame.id,
    )
    return { document, frame, child }
  }

  it('does not let you click the part of a child that is clipped away', () => {
    const { document, child } = clipped(true)
    // Inside the frame, so still visible and still the deepest hit.
    expect(hitTest(document, { x: 90, y: 50 })?.id).toBe(child.id)
    // Past the frame's right edge. Nothing is drawn there.
    expect(hitTest(document, { x: 120, y: 50 })).toBeNull()
  })

  it('leaves the overhang clickable when the frame does not clip', () => {
    const { document, child } = clipped(false)
    expect(hitTest(document, { x: 120, y: 50 })?.id).toBe(child.id)
  })

  it('clips to the frame geometry, not to its stroke', () => {
    const { document, frame } = clipped(true)
    document.update<FrameNode>(frame.id, {
      strokes: [{ paint: fromHex('#ff0000'), weight: 40, align: 'outside' }],
    })
    // The stroke reaches to 140, but a child is still only allowed inside 100.
    expect(hitTest(document, { x: 120, y: 50 })?.id).toBe(frame.id)
  })

  it('honours the corner radius, so a clipped corner is really cut', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 100, height: 100 }, cornerRadius: 40, clipsContent: true }),
    )
    const child = document.insert(
      createRectangle({ size: { width: 100, height: 100 } }),
      frame.id,
    )
    expect(hitTest(document, { x: 50, y: 50 })?.id).toBe(child.id)
    // Well outside the radius 40 arc centred at (40,40).
    expect(hitTest(document, { x: 4, y: 4 })).toBeNull()
  })

  it('compounds through nested clipping frames', () => {
    const document = new SceneDocument()
    const outer = document.insert(createFrame({ size: { width: 100, height: 100 } }))
    const inner = document.insert(
      createFrame({ transform: translation(50, 0), size: { width: 100, height: 100 } }),
      outer.id,
    )
    const child = document.insert(
      createRectangle({ size: { width: 100, height: 100 } }),
      inner.id,
    )
    // The child survives only where both frames overlap, world 50 to 100.
    expect(hitTest(document, { x: 75, y: 50 })?.id).toBe(child.id)
    expect(hitTest(document, { x: 120, y: 50 })).toBeNull()
  })

  it('keeps a clipped child out of a marquee that only touches its overhang', () => {
    const { document } = clipped(true)
    expect(nodesIn(document, { x: 110, y: 40, width: 40, height: 20 })).toEqual([])
  })

  it('still catches a clipped child where it is actually visible', () => {
    const { document, child } = clipped(true)
    const caught = nodesIn(document, { x: 80, y: 40, width: 40, height: 20 })
    expect(caught.map((node) => node.id)).toContain(child.id)
  })
})

describe('hitTest, on a text node', () => {
  /** A text node whose measured bounds span (20,20) to (140,50) in world space. */
  function withText(strokes: Stroke[] = []) {
    const document = new SceneDocument()
    const text = document.insert(
      createText({
        name: 'Text',
        transform: translation(20, 20),
        size: { width: 120, height: 30 },
        characters: 'Hello',
        strokes,
      }),
    )
    return { document, text }
  }

  it('is clickable across its measured bounds', () => {
    const { document, text } = withText()
    expect(hitTest(document, { x: 80, y: 35 })?.id).toBe(text.id)
  })

  it('has square corners, so the very corner of the box still counts', () => {
    const { document, text } = withText()
    expect(hitTest(document, { x: 21, y: 21 })?.id).toBe(text.id)
  })

  it('is not clickable outside them', () => {
    const { document } = withText()
    expect(hitTest(document, { x: 150, y: 35 })).toBeNull()
  })

  /*
   * A text node carries strokes because every painted node does, but nothing draws them yet.
   * If the outset were applied anyway, the node would be clickable in a band around itself
   * where there is visibly nothing, which is the exact disagreement this file exists to stop.
   */
  it('is not grown by a stroke, because its stroke is not drawn', () => {
    const stroke: Stroke = { paint: fromHex('#000000'), weight: 20, align: 'outside' }
    const { document } = withText([stroke])
    expect(hitTest(document, { x: 150, y: 35 })).toBeNull()
  })

  it('has no clickable area before anything is typed into it', () => {
    const document = new SceneDocument()
    document.insert(createText({ transform: translation(20, 20) }))
    expect(hitTest(document, { x: 20, y: 20 })).toBeNull()
  })

  it('is caught by a marquee that encloses it', () => {
    const { document, text } = withText()
    const caught = nodesIn(document, { x: 0, y: 0, width: 200, height: 100 })
    expect(caught.map((node) => node.id)).toContain(text.id)
  })

  it('is hidden by a frame that clips it', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 100, height: 100 }, clipsContent: true }),
    )
    document.insert(
      createText({
        transform: translation(80, 40),
        size: { width: 120, height: 30 },
        characters: 'Hello',
      }),
      frame.id,
    )
    // Inside the frame the text answers; past its right edge the frame has cut it off.
    expect(hitTest(document, { x: 90, y: 50 })?.type).toBe('text')
    expect(hitTest(document, { x: 150, y: 50 })).toBeNull()
  })
})
