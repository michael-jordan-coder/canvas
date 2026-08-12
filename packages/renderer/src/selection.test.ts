import { describe, expect, it } from 'vitest'
import { SceneDocument, createFrame, createRectangle, translation } from '@figma-canvas/document'
import type { Camera, Viewport } from './camera.js'
import {
  handleAt,
  handlePoints,
  selectionScreenBounds,
  selectionWorldBounds,
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

describe('selectionScreenBounds', () => {
  it('converts through the camera and snaps to a half pixel', () => {
    const { document, rectangle } = scene()
    expect(selectionScreenBounds(document, [rectangle.id], origin, viewport)).toEqual({
      x: 264.5,
      y: 204.5,
      width: 140,
      height: 90,
    })
  })

  it('scales with zoom', () => {
    const { document, rectangle } = scene()
    const bounds = selectionScreenBounds(document, [rectangle.id], { ...origin, zoom: 2 }, viewport)
    expect(bounds?.width).toBe(280)
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
  const box = { x: 100, y: 100, width: 200, height: 100 }

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
    const short = { x: 0, y: 0, width: 30, height: 100 }
    expect(handleAt(short, { x: 0, y: 0 })).toBe('nw')
  })
})
