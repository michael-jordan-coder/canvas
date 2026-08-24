import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createFrame,
  createRectangle,
  degrees,
  multiply,
  radians,
  rotateAbout,
  translation,
} from '@canvas/document'
import type { Camera, Viewport } from './camera.js'
import {
  boxCentre,
  fromBoxSpace,
  grabAt,
  handleAt,
  handlePoints,
  handleScreenPoint,
  rotateHandlePoint,
  selectionBox,
  selectionWorldBounds,
  toBoxSpace,
} from './selection.js'

const viewport: Viewport = { width: 800, height: 600 }
const origin: Camera = { x: 0, y: 0, zoom: 1 }

function scene() {
  const document = new SceneDocument()
  const rectangle = document.insert(
    createRectangle({ transform: translation(-136, -96), size: { width: 140, height: 90 } }),
  )
  const tiny = document.insert(
    createRectangle({ transform: translation(200, 200), size: { width: 10, height: 10 } }),
  )
  return { document, rectangle, tiny }
}

describe('selectionWorldBounds', () => {
  it('is null with nothing selected', () => {
    const { document } = scene()
    expect(selectionWorldBounds(document, [])).toBeNull()
  })

  it('reports the node box in world units', () => {
    const { document, rectangle } = scene()
    expect(selectionWorldBounds(document, [rectangle.id])).toEqual({
      x: -136,
      y: -96,
      width: 140,
      height: 90,
    })
  })

  it('accounts for a scaled parent', () => {
    const document = new SceneDocument()
    const parent = document.insert(
      createFrame({ transform: { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 0 } }),
    )
    const child = document.insert(
      createRectangle({ transform: translation(10, 5), size: { width: 20, height: 20 } }),
      parent.id,
    )
    expect(selectionWorldBounds(document, [child.id])).toEqual({
      x: 120,
      y: 10,
      width: 40,
      height: 40,
    })
  })

  it('unions a multiple selection', () => {
    const { document, rectangle, tiny } = scene()
    const bounds = selectionWorldBounds(document, [rectangle.id, tiny.id])
    expect(bounds).toEqual({ x: -136, y: -96, width: 346, height: 306 })
  })
})

describe('handlePoints', () => {
  it('gives eight handles on a box with room for them', () => {
    expect(handlePoints({ x: 0, y: 0, width: 100, height: 50 })).toHaveLength(8)
  })

  it('drops the edge handles on a box too small to fit them', () => {
    expect(handlePoints({ x: 0, y: 0, width: 10, height: 10 })).toHaveLength(4)
  })

  it('drops only the handles on the axis that is too short', () => {
    const points = handlePoints({ x: 0, y: 0, width: 100, height: 10 })
    expect(points.map((point) => point.id).sort()).toEqual(['n', 'ne', 'nw', 's', 'se', 'sw'])
  })
})

describe('handleAt', () => {
  /** Upright, so these cases say what the handle layout is without rotation in the way. */
  const box = { rect: { x: 100, y: 100, width: 200, height: 100 }, angle: 0 }

  it('finds a corner handle when the pointer is on it', () => {
    expect(handleAt(box, { x: 100, y: 100 })).toBe('nw')
    expect(handleAt(box, { x: 300, y: 200 })).toBe('se')
  })

  it('finds an edge handle at the middle of a side', () => {
    expect(handleAt(box, { x: 200, y: 100 })).toBe('n')
    expect(handleAt(box, { x: 300, y: 150 })).toBe('e')
  })

  it('has a grab area slightly larger than the drawn handle', () => {
    // Handles are drawn 8px, so 4px away is still on it, and the grab area reaches further.
    expect(handleAt(box, { x: 104, y: 104 })).toBe('nw')
    expect(handleAt(box, { x: 105, y: 105 })).toBe('nw')
  })

  it('returns null away from every handle', () => {
    expect(handleAt(box, { x: 200, y: 150 })).toBeNull()
    expect(handleAt(box, { x: 500, y: 500 })).toBeNull()
  })

  it('prefers the corner where a corner and an edge grab area overlap', () => {
    // On a short box the north edge handle sits close to both corners.
    const short = { rect: { x: 0, y: 0, width: 30, height: 100 }, angle: 0 }
    expect(handleAt(short, { x: 0, y: 0 })).toBe('nw')
  })
})

describe('selectionBox on a rotated node', () => {
  const camera: Camera = origin

  /** A 100 by 60 rectangle whose centre sits at world (50, 30), turned by `deg`. */
  function turned(deg: number) {
    const document = new SceneDocument()
    const node = document.insert(createRectangle({ size: { width: 100, height: 60 } }))
    if (deg !== 0) {
      const centre = { x: 50, y: 30 }
      document.update(node.id, {
        transform: multiply(node.transform, rotateAbout(centre, radians(deg))),
      })
    }
    return { document, node }
  }

  it('carries the node angle rather than flattening it', () => {
    const { document, node } = turned(30)
    const box = selectionBox(document, [node.id], camera, viewport)
    expect(degrees(box?.angle ?? 0)).toBeCloseTo(30, 6)
  })

  it('keeps the box the node size, not the size of an upright box around it', () => {
    const { document, node } = turned(30)
    const box = selectionBox(document, [node.id], camera, viewport)
    expect(box?.rect.width).toBeCloseTo(100, 6)
    expect(box?.rect.height).toBeCloseTo(60, 6)
  })

  it('centres the box on the node, which is the point it turns about', () => {
    const { document, node } = turned(30)
    const box = selectionBox(document, [node.id], camera, viewport)
    // World (50,30) with an 800x600 viewport at zoom 1 lands at 400+50, 300+30.
    expect(boxCentre(box!.rect).x).toBeCloseTo(450, 6)
    expect(boxCentre(box!.rect).y).toBeCloseTo(330, 6)
  })

  it('places a corner where the node corner actually is', () => {
    const { document, node } = turned(90)
    const box = selectionBox(document, [node.id], camera, viewport)
    // A quarter turn about (50,30) sends the local origin to (80,-20) in world.
    const nw = handleScreenPoint(box!, 'nw')
    expect(nw.x).toBeCloseTo(400 + 80, 6)
    expect(nw.y).toBeCloseTo(300 + -20, 6)
  })

  it('collapses a multiple selection to an upright box', () => {
    const { document, node } = turned(30)
    const other = document.insert(createRectangle({ size: { width: 10, height: 10 } }))
    const box = selectionBox(document, [node.id, other.id], camera, viewport)
    expect(box?.angle).toBe(0)
  })

  it('grabs a handle on a turned box where it is drawn, not where upright would put it', () => {
    const { document, node } = turned(90)
    const box = selectionBox(document, [node.id], camera, viewport)
    const nw = handleScreenPoint(box!, 'nw')
    expect(handleAt(box!, nw)).toBe('nw')
    // The upright box's own north west corner is nowhere near it once turned.
    expect(handleAt(box!, { x: box!.rect.x, y: box!.rect.y })).not.toBe('nw')
  })

  it('round trips a point through the box frame and back', () => {
    const { document, node } = turned(37)
    const box = selectionBox(document, [node.id], camera, viewport)
    const point = { x: 123, y: 456 }
    const back = fromBoxSpace(box!, toBoxSpace(box!, point))
    expect(back.x).toBeCloseTo(point.x, 6)
    expect(back.y).toBeCloseTo(point.y, 6)
  })
})

describe('grabAt', () => {
  const box = { rect: { x: 100, y: 100, width: 200, height: 100 }, angle: 0 }

  it('finds the rotate handle above the top edge', () => {
    const point = rotateHandlePoint(box.rect)
    expect(grabAt(box, point)).toBe('rotate')
  })

  it('keeps the rotate handle clear of the north resize handle', () => {
    expect(grabAt(box, { x: 200, y: 100 })).toBe('n')
  })

  it('still finds the corners', () => {
    expect(grabAt(box, { x: 100, y: 100 })).toBe('nw')
  })

  it('returns null in open space above the handle', () => {
    expect(grabAt(box, { x: 200, y: 40 })).toBeNull()
  })

  it('follows the box round, so a turned box is grabbed where the stem points', () => {
    const turnedBox = { rect: box.rect, angle: Math.PI / 2 }
    const drawn = fromBoxSpace(turnedBox, rotateHandlePoint(turnedBox.rect))
    expect(grabAt(turnedBox, drawn)).toBe('rotate')
    // Straight above the box is where it would have been had rotation been ignored.
    expect(grabAt(turnedBox, rotateHandlePoint(turnedBox.rect))).not.toBe('rotate')
  })
})
