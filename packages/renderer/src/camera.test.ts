import { describe, expect, it } from 'vitest'
import { applyToPoint, type Vec2 } from '@figma-canvas/document'
import {
  clipMatrix,
  fitTo,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Camera,
  type Viewport,
} from './camera.js'

const viewport: Viewport = { width: 800, height: 600 }
const origin: Camera = { x: 0, y: 0, zoom: 1 }

const closeTo = (point: Vec2, x: number, y: number, precision = 9): void => {
  expect(point.x).toBeCloseTo(x, precision)
  expect(point.y).toBeCloseTo(y, precision)
}

describe('viewMatrix', () => {
  it('puts the camera position at the centre of the viewport', () => {
    closeTo(worldToScreen(origin, viewport, { x: 0, y: 0 }), 400, 300)
    closeTo(worldToScreen({ x: 100, y: 50, zoom: 1 }, viewport, { x: 100, y: 50 }), 400, 300)
  })

  it('moves content the opposite way to the camera', () => {
    closeTo(worldToScreen({ x: 100, y: 50, zoom: 1 }, viewport, { x: 0, y: 0 }), 300, 250)
  })

  it('scales distance from the camera by the zoom', () => {
    closeTo(worldToScreen(origin, viewport, { x: 100, y: 0 }), 500, 300)
    closeTo(worldToScreen({ x: 100, y: 0, zoom: 2 }, viewport, { x: 150, y: 0 }), 500, 300)
  })

  it.each([
    ['identity', origin],
    ['panned', { x: 100, y: 50, zoom: 1 }],
    ['zoomed in', { x: 100, y: 0, zoom: 2 }],
    ['zoomed out', { x: -37, y: 912, zoom: 0.35 }],
  ])('round trips screen and world when %s', (_label, camera) => {
    const point = { x: 123.5, y: -44.25 }
    closeTo(screenToWorld(camera, viewport, worldToScreen(camera, viewport, point)), 123.5, -44.25, 6)
  })
})

describe('clipMatrix', () => {
  const clip = (camera: Camera, point: Vec2): Vec2 =>
    applyToPoint(clipMatrix(camera, viewport), point)

  it('puts the camera at the centre of clip space', () => {
    closeTo(clip(origin, { x: 0, y: 0 }), 0, 0)
  })

  it('maps the left edge to -1', () => {
    closeTo(clip(origin, { x: -400, y: 0 }), -1, 0)
  })

  it('flips y, because clip space points up and pixels point down', () => {
    closeTo(clip(origin, { x: 0, y: -300 }), 0, 1)
  })
})

describe('zoomAt', () => {
  it('leaves the world point under the cursor exactly where it was', () => {
    const camera: Camera = { x: 100, y: 0, zoom: 2 }
    const pointer = { x: 620, y: 140 }
    const before = screenToWorld(camera, viewport, pointer)
    const after = zoomAt(camera, viewport, pointer, 1.7)
    closeTo(screenToWorld(after, viewport, pointer), before.x, before.y, 6)
  })

  it('clamps rather than running away', () => {
    expect(zoomAt(origin, viewport, { x: 0, y: 0 }, 1e6).zoom).toBeLessThanOrEqual(256)
    expect(zoomAt(origin, viewport, { x: 0, y: 0 }, 1e-6).zoom).toBeGreaterThanOrEqual(0.02)
  })
})

describe('fitTo', () => {
  it('centres the rect and scales it to the tighter axis', () => {
    const rect = { x: -160, y: -120, width: 320, height: 240 }
    const fitted = fitTo(rect, viewport, 64)
    closeTo(worldToScreen(fitted, viewport, { x: 0, y: 0 }), 400, 300, 6)
    // 600 tall minus 64 of padding each side, over the rect's 240.
    expect(fitted.zoom).toBeCloseTo(472 / 240, 6)
  })
})
