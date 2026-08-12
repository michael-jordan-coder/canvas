import { beforeEach, describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createEllipse,
  createFrame,
  createRectangle,
  fromHex,
  translation,
} from '@figma-canvas/document'
import type { Camera, Viewport } from '../camera.js'
import { ShapeInstances } from './ShapeInstances.js'
import { createStubDevice, instanceAt } from './testing/stubDevice.js'

/** linear (4) + origin and size (4) + colour (4) + params (4). */
const STRIDE = 16

/** Wide enough that the seeded scene is entirely inside it, so nothing is culled. */
const viewport: Viewport = { width: 2000, height: 2000 }
const camera: Camera = { x: 0, y: 0, zoom: 1 }

const FIELD = {
  originX: 4,
  originY: 5,
  width: 6,
  height: 7,
  red: 8,
  blue: 10,
  alpha: 11,
  cornerRadius: 12,
  kind: 13,
} as const

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
      transform: translation(24, 24),
      size: { width: 140, height: 90 },
      fills: [fromHex('#0a7cff')],
      cornerRadius: 4,
    }),
    frame.id,
  )
  const ellipse = document.insert(
    createEllipse({
      transform: translation(170, 130),
      size: { width: 90, height: 90 },
      fills: [fromHex('#1a1a1a')],
    }),
    frame.id,
  )
  return { document, frame, rectangle, ellipse }
}

let world: ReturnType<typeof scene>
let stub: ReturnType<typeof createStubDevice>
let instances: ShapeInstances

beforeEach(() => {
  world = scene()
  stub = createStubDevice()
  instances = new ShapeInstances(stub.device)
  instances.sync(world.document, camera, viewport)
})

const field = (index: number, slot: number): number =>
  instanceAt(stub.written(), STRIDE, index, slot)

describe('ShapeInstances', () => {
  it('packs one instance per painted node, skipping the page', () => {
    expect(instances.count).toBe(3)
  })

  it('writes size in the node own units', () => {
    expect(field(0, FIELD.width)).toBe(320)
    expect(field(0, FIELD.height)).toBe(240)
  })

  it('accumulates the parent transform into world space', () => {
    expect(field(0, FIELD.originX)).toBe(-160)
    // The rectangle sits 24 into a frame at -136, not at its own local 24.
    expect(field(1, FIELD.originX)).toBe(-136)
    expect(field(2, FIELD.originX)).toBe(10)
    expect(field(2, FIELD.originY)).toBe(10)
  })

  it('carries the corner radius and the shape kind', () => {
    expect(field(1, FIELD.cornerRadius)).toBe(4)
    expect(field(1, FIELD.kind)).toBe(0)
    expect(field(2, FIELD.kind)).toBe(1)
  })

  it('writes colour channels as 0 to 1, not 0 to 255', () => {
    expect(field(1, FIELD.red)).toBeCloseTo(10 / 255, 4)
    expect(field(1, FIELD.blue)).toBeCloseTo(1, 4)
  })

  it('drops a hidden node and everything under it', () => {
    world.document.update(world.frame.id, { visible: false })
    instances.sync(world.document, camera, viewport)
    expect(instances.count).toBe(0)
  })

  it('multiplies opacity down the tree', () => {
    world.document.update(world.frame.id, { opacity: 0.5 })
    instances.sync(world.document, camera, viewport)
    expect(field(1, FIELD.alpha)).toBeCloseTo(0.5, 6)
  })

  it('rebuilds only when the document version changes', () => {
    const before = stub.written()
    instances.sync(world.document, camera, viewport)
    // Same array instance means writeBuffer was never called again.
    expect(stub.written()).toBe(before)
  })
})

describe('culling', () => {
  /** A row of 100 shapes 200 apart, so most of them are far off screen. */
  function spread() {
    const document = new SceneDocument()
    document.transact(() => {
      for (let index = 0; index < 100; index += 1) {
        document.insert(
          createRectangle({
            transform: translation(index * 200, 0),
            size: { width: 100, height: 100 },
            fills: [fromHex('#0a7cff')],
          }),
        )
      }
    })
    return document
  }

  const small: Viewport = { width: 800, height: 600 }

  it('submits only what is near the view', () => {
    const document = spread()
    const builder = new ShapeInstances(createStubDevice().device)
    builder.sync(document, { x: 0, y: 0, zoom: 1 }, small)

    expect(builder.count).toBeGreaterThan(0)
    expect(builder.count).toBeLessThan(20)
    expect(builder.count + builder.culled).toBe(100)
  })

  it('keeps a shape that is only partly in view', () => {
    const document = new SceneDocument()
    // Straddling the left edge of an 800 wide viewport centred on the origin.
    document.insert(
      createRectangle({
        transform: translation(-420, 0),
        size: { width: 100, height: 100 },
        fills: [fromHex('#0a7cff')],
      }),
    )
    const builder = new ShapeInstances(createStubDevice().device)
    builder.sync(document, { x: 0, y: 0, zoom: 1 }, small)
    expect(builder.count).toBe(1)
  })

  it('does not rebuild while the camera stays inside the built margin', () => {
    const document = spread()
    const stubbed = createStubDevice()
    const builder = new ShapeInstances(stubbed.device)
    builder.sync(document, { x: 0, y: 0, zoom: 1 }, small)

    const before = stubbed.written()
    builder.sync(document, { x: 30, y: 0, zoom: 1 }, small)
    // The margin is there precisely so an ordinary pan costs nothing.
    expect(stubbed.written()).toBe(before)
  })

  it('rebuilds once the camera leaves the region it was built for', () => {
    const document = spread()
    const stubbed = createStubDevice()
    const builder = new ShapeInstances(stubbed.device)
    builder.sync(document, { x: 0, y: 0, zoom: 1 }, small)

    const before = stubbed.written()
    builder.sync(document, { x: 8000, y: 0, zoom: 1 }, small)
    expect(stubbed.written()).not.toBe(before)
    expect(builder.count).toBeGreaterThan(0)
  })

  it('shows everything when the whole scene fits on screen', () => {
    const document = spread()
    const builder = new ShapeInstances(createStubDevice().device)
    builder.sync(document, { x: 10_000, y: 0, zoom: 0.02 }, { width: 4000, height: 4000 })
    expect(builder.culled).toBe(0)
    expect(builder.count).toBe(100)
  })
})
