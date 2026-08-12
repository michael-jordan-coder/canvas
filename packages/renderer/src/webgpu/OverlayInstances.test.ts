import { beforeEach, describe, expect, it } from 'vitest'
import { SceneDocument, createRectangle, translation } from '@figma-canvas/document'
import type { Camera, Viewport } from '../camera.js'
import { OverlayInstances } from './OverlayInstances.js'
import { createStubDevice, instanceAt } from './testing/stubDevice.js'

const STRIDE = 16
const FIELD = { x: 0, y: 1, width: 2, height: 3, fillAlpha: 7, strokeWidth: 12 } as const

const viewport: Viewport = { width: 800, height: 600 }
const origin: Camera = { x: 0, y: 0, zoom: 1 }

function scene() {
  const document = new SceneDocument()
  // Spans (-136,-96) to (4,-6) in world, which is (264,204) to (404,294) on screen at 1x.
  const rectangle = document.insert(
    createRectangle({ transform: translation(-136, -96), size: { width: 140, height: 90 } }),
  )
  const tiny = document.insert(
    createRectangle({ transform: translation(200, 200), size: { width: 10, height: 10 } }),
  )
  return { document, rectangle, tiny }
}

let world: ReturnType<typeof scene>
let stub: ReturnType<typeof createStubDevice>
let overlay: OverlayInstances

beforeEach(() => {
  world = scene()
  stub = createStubDevice()
  overlay = new OverlayInstances(stub.device)
})

const field = (index: number, slot: number): number =>
  instanceAt(stub.written('overlay instances'), STRIDE, index, slot)

/**
 * Instance order, so these stop being bare numbers that shift every time the overlay gains
 * a part. Outline first, then the rotate stem and knob, then the resize handles.
 */
const OUTLINE = 0
const FIRST_HANDLE = 3
/** Outline, stem, knob, then eight resize handles. */
const FULL_COUNT = 11
/** The same without the four edge handles. */
const CORNERS_ONLY = 7

describe('OverlayInstances', () => {
  it('draws nothing when nothing is selected', () => {
    overlay.sync(world.document, [], origin, viewport)
    expect(overlay.count).toBe(0)
  })

  it('draws an outline and eight handles around a selection', () => {
    overlay.sync(world.document, [world.rectangle.id], origin, viewport)
    expect(overlay.count).toBe(FULL_COUNT)
  })

  it('places the outline on a half pixel so a one pixel stroke lands on one pixel', () => {
    overlay.sync(world.document, [world.rectangle.id], origin, viewport)
    expect(field(OUTLINE, FIELD.x)).toBe(264.5)
    expect(field(OUTLINE, FIELD.y)).toBe(204.5)
    expect(field(OUTLINE, FIELD.width)).toBe(140)
    expect(field(OUTLINE, FIELD.height)).toBe(90)
    expect(field(OUTLINE, FIELD.fillAlpha)).toBe(0)
    expect(field(OUTLINE, FIELD.strokeWidth)).toBe(1)
  })

  it.each([
    [0.25, 35],
    [1, 140],
    [4, 560],
  ])('scales the outline with zoom %s', (zoom, width) => {
    overlay.sync(world.document, [world.rectangle.id], { ...origin, zoom }, viewport)
    expect(field(OUTLINE, FIELD.width)).toBe(width)
  })

  it.each([0.25, 1, 4])('keeps handles the same size on screen at zoom %s', (zoom) => {
    overlay.sync(world.document, [world.rectangle.id], { ...origin, zoom }, viewport)
    // This is the whole reason the overlay has its own pipeline.
    expect(field(FIRST_HANDLE, FIELD.width)).toBe(8)
    expect(field(FIRST_HANDLE, FIELD.height)).toBe(8)
  })

  it('centres a handle on the corner it belongs to', () => {
    overlay.sync(world.document, [world.rectangle.id], origin, viewport)
    expect(field(FIRST_HANDLE, FIELD.x)).toBe(265 - 4)
  })

  it('drops the edge handles when the box is too small for them', () => {
    overlay.sync(world.document, [world.tiny.id], origin, viewport)
    expect(overlay.count).toBe(CORNERS_ONLY)
  })

  it('wraps a multiple selection in one box', () => {
    overlay.sync(world.document, [world.rectangle.id, world.tiny.id], origin, viewport)
    expect(field(OUTLINE, FIELD.x)).toBe(264.5)
    expect(field(OUTLINE, FIELD.width)).toBe(Math.round(210 - -136))
  })
})
