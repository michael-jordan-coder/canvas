import { beforeEach, describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createEllipse,
  createFrame,
  createRectangle,
  createText,
  fromHex,
  translation,
  type FontMetrics,
  type GlyphMetrics,
  type StrokeAlign,
} from '@figma-canvas/document'
import type { Camera, Viewport } from '../camera.js'
import { ClipRegions, createClipBindGroupLayout } from './ClipRegions.js'
import { ShapeInstances } from './ShapeInstances.js'
import { createStubDevice, instanceAt, type StubDevice } from './testing/stubDevice.js'

/*
 * A made up font with round numbers, the same one the layout tests use. Every letter
 * advances half an em and its ink covers the top left quarter of the atlas, so a glyph's
 * quad and its texture coordinates can both be checked by hand.
 */
const GLYPH: GlyphMetrics = {
  advance: 0.5,
  quad: {
    plane: { x: 0, y: -0.5, width: 0.5, height: 0.5 },
    uv: { x: 0.25, y: 0.5, width: 0.125, height: 0.25 },
  },
}

const METRICS: FontMetrics = {
  lineHeight: 1.25,
  ascender: -1,
  descender: 0.25,
  pxRange: 4,
  fallback: 0x3f,
  glyphs: new Map<number, GlyphMetrics>([
    [0x20, { advance: 0.25, quad: null }],
    [0x3f, GLYPH],
    [0x61, GLYPH],
    [0x62, GLYPH],
  ]),
}

/** The builder needs somewhere to record clipping frames, whether or not the scene has any. */
function build(stubbed: StubDevice): ShapeInstances {
  const clips = new ClipRegions(stubbed.device, createClipBindGroupLayout(stubbed.device))
  return new ShapeInstances(stubbed.device, clips, METRICS)
}

/** linear (4) + origin and size (4) + colour (4) + params (4) + flags (4). */
const STRIDE = 20

/** Wide enough that the seeded scene is entirely inside it, so nothing is culled. */
const viewport: Viewport = { width: 2000, height: 2000 }
const camera: Camera = { x: 0, y: 0, zoom: 1 }

const FIELD = {
  originX: 4,
  originY: 5,
  width: 6,
  height: 7,
  red: 8,
  green: 9,
  blue: 10,
  alpha: 11,
  cornerRadius: 12,
  kind: 13,
  strokeWeight: 14,
  strokeOffset: 15,
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
  instances = build(stub)
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

  it('leaves the stroke fields at zero on a fill', () => {
    expect(field(1, FIELD.strokeWeight)).toBe(0)
    expect(field(1, FIELD.strokeOffset)).toBe(0)
  })
})

describe('strokes', () => {
  function stroked(align: StrokeAlign, weight = 4) {
    const document = new SceneDocument()
    const rectangle = document.insert(
      createRectangle({
        size: { width: 100, height: 60 },
        fills: [fromHex('#0a7cff')],
        strokes: [{ paint: fromHex('#ff0000'), weight, align }],
      }),
    )
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    builder.sync(document, camera, viewport)
    return {
      document,
      rectangle,
      builder,
      at: (index: number, slot: number) => instanceAt(stubbed.written(), STRIDE, index, slot),
    }
  }

  it('adds a second instance for the stroke, sharing the geometry of the fill', () => {
    const { builder, at } = stroked('center')
    expect(builder.count).toBe(2)
    expect(at(1, FIELD.width)).toBe(at(0, FIELD.width))
    expect(at(1, FIELD.originX)).toBe(at(0, FIELD.originX))
    expect(at(1, FIELD.cornerRadius)).toBe(at(0, FIELD.cornerRadius))
  })

  it('gives the stroke its own colour rather than the fill colour', () => {
    const { at } = stroked('center')
    expect(at(0, FIELD.red)).toBeCloseTo(10 / 255, 4)
    expect(at(1, FIELD.red)).toBe(1)
    expect(at(1, FIELD.green)).toBe(0)
  })

  it('packs the stroke after the fill, so it paints on top of it', () => {
    const { at } = stroked('center')
    expect(at(0, FIELD.strokeWeight)).toBe(0)
    expect(at(1, FIELD.strokeWeight)).toBe(4)
  })

  // The band is `abs(d - offset) <= weight / 2` around a distance that is negative inside
  // the shape, so alignment is entirely carried by the sign of the offset.
  it('turns alignment into a signed offset', () => {
    expect(stroked('inside').at(1, FIELD.strokeOffset)).toBe(-2)
    expect(stroked('center').at(1, FIELD.strokeOffset)).toBe(0)
    expect(stroked('outside').at(1, FIELD.strokeOffset)).toBe(2)
  })

  it('draws a stroke on a node with no fill at all', () => {
    const document = new SceneDocument()
    document.insert(
      createRectangle({
        size: { width: 100, height: 60 },
        strokes: [{ paint: fromHex('#ff0000'), weight: 2, align: 'center' }],
      }),
    )
    const builder = build(createStubDevice())
    builder.sync(document, camera, viewport)
    expect(builder.count).toBe(1)
  })

  it('ignores a stroke with no weight', () => {
    const { builder } = stroked('center', 0)
    expect(builder.count).toBe(1)
  })

  it('puts a frame stroke after its children, so contents cannot paint over it', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 200, height: 200 },
        fills: [fromHex('#ffffff')],
        strokes: [{ paint: fromHex('#ff0000'), weight: 2, align: 'inside' }],
      }),
    )
    document.insert(
      createRectangle({ size: { width: 200, height: 200 }, fills: [fromHex('#000000')] }),
      frame.id,
    )
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    builder.sync(document, camera, viewport)

    // Frame fill, child fill, then the frame's own stroke last.
    expect(builder.count).toBe(3)
    expect(instanceAt(stubbed.written(), STRIDE, 2, FIELD.strokeWeight)).toBe(2)
  })

  it('culls an outward stroke by its own reach, not the node box', () => {
    const document = new SceneDocument()
    // A 100 wide viewport sees x from -50 to 50 plus half a viewport of margin, so out to
    // 100. The node starts at 130 and is invisible, but a 60 wide outside stroke reaches
    // back to 100 and has to survive.
    document.insert(
      createRectangle({
        transform: translation(130, 0),
        size: { width: 40, height: 40 },
        strokes: [{ paint: fromHex('#ff0000'), weight: 60, align: 'outside' }],
      }),
    )
    const builder = build(createStubDevice())
    builder.sync(document, { x: 0, y: 0, zoom: 1 }, { width: 100, height: 100 })
    expect(builder.count).toBe(1)
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
    const builder = build(createStubDevice())
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
    const builder = build(createStubDevice())
    builder.sync(document, { x: 0, y: 0, zoom: 1 }, small)
    expect(builder.count).toBe(1)
  })

  it('does not rebuild while the camera stays inside the built margin', () => {
    const document = spread()
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    builder.sync(document, { x: 0, y: 0, zoom: 1 }, small)

    const before = stubbed.written()
    builder.sync(document, { x: 30, y: 0, zoom: 1 }, small)
    // The margin is there precisely so an ordinary pan costs nothing.
    expect(stubbed.written()).toBe(before)
  })

  it('rebuilds once the camera leaves the region it was built for', () => {
    const document = spread()
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    builder.sync(document, { x: 0, y: 0, zoom: 1 }, small)

    const before = stubbed.written()
    builder.sync(document, { x: 8000, y: 0, zoom: 1 }, small)
    expect(stubbed.written()).not.toBe(before)
    expect(builder.count).toBeGreaterThan(0)
  })

  it('shows everything when the whole scene fits on screen', () => {
    const document = spread()
    const builder = build(createStubDevice())
    builder.sync(document, { x: 10_000, y: 0, zoom: 0.02 }, { width: 4000, height: 4000 })
    expect(builder.culled).toBe(0)
    expect(builder.count).toBe(100)
  })
})

describe('clipsContent', () => {
  /** worldInverse as 3 padded columns, then size, radius and the enclosing clip. */
  const CLIP_STRIDE = 16
  const CLIP = {
    a: 0,
    b: 1,
    pad0: 2,
    c: 4,
    d: 5,
    pad1: 6,
    tx: 8,
    ty: 9,
    one: 10,
    width: 12,
    height: 13,
    radius: 14,
    parent: 15,
  } as const

  const INSTANCE_CLIP = 16

  function read(stubbed: StubDevice) {
    return {
      instance: (index: number, slot: number) =>
        instanceAt(stubbed.written(), STRIDE, index, slot),
      clip: (index: number, slot: number) =>
        instanceAt(stubbed.written('clip regions'), CLIP_STRIDE, index, slot),
    }
  }

  function frameWith(clipsContent: boolean) {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        transform: translation(40, 25),
        size: { width: 100, height: 80 },
        cornerRadius: 6,
        fills: [fromHex('#ffffff')],
        clipsContent,
      }),
    )
    document.insert(
      createRectangle({ size: { width: 20, height: 20 }, fills: [fromHex('#0a7cff')] }),
      frame.id,
    )
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    builder.sync(document, camera, viewport)
    return { document, frame, builder, ...read(stubbed) }
  }

  it('records nothing and points every instance at no clip when nothing clips', () => {
    const { instance } = frameWith(false)
    expect(instance(0, INSTANCE_CLIP)).toBe(-1)
    expect(instance(1, INSTANCE_CLIP)).toBe(-1)
  })

  it('puts the children under the frame clip but not the frame itself', () => {
    const { instance } = frameWith(true)
    // A frame does not clip its own paint, which is what lets an outward stroke show.
    expect(instance(0, INSTANCE_CLIP)).toBe(-1)
    expect(instance(1, INSTANCE_CLIP)).toBe(0)
  })

  it('stores the inverse world transform, since the shader maps world back into the frame', () => {
    const { clip } = frameWith(true)
    expect(clip(0, CLIP.a)).toBe(1)
    expect(clip(0, CLIP.d)).toBe(1)
    expect(clip(0, CLIP.tx)).toBe(-40)
    expect(clip(0, CLIP.ty)).toBe(-25)
  })

  it('pads each matrix column to 16 bytes', () => {
    const { clip } = frameWith(true)
    expect(clip(0, CLIP.pad0)).toBe(0)
    expect(clip(0, CLIP.pad1)).toBe(0)
    // The third column is a position, so its homogeneous coordinate is 1, not 0.
    expect(clip(0, CLIP.one)).toBe(1)
  })

  it('carries the size and corner radius the clip is shaped by', () => {
    const { clip } = frameWith(true)
    expect(clip(0, CLIP.width)).toBe(100)
    expect(clip(0, CLIP.height)).toBe(80)
    expect(clip(0, CLIP.radius)).toBe(6)
    expect(clip(0, CLIP.parent)).toBe(-1)
  })

  it('chains a nested clip to the one outside it', () => {
    const document = new SceneDocument()
    const outer = document.insert(
      createFrame({ size: { width: 200, height: 200 }, fills: [fromHex('#ffffff')] }),
    )
    const inner = document.insert(
      createFrame({
        transform: translation(20, 20),
        size: { width: 100, height: 100 },
        fills: [fromHex('#eeeeee')],
      }),
      outer.id,
    )
    document.insert(
      createRectangle({ size: { width: 40, height: 40 }, fills: [fromHex('#0a7cff')] }),
      inner.id,
    )
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    builder.sync(document, camera, viewport)
    const { instance, clip } = read(stubbed)

    expect(clip(0, CLIP.parent)).toBe(-1)
    expect(clip(1, CLIP.parent)).toBe(0)
    // Outer fill unclipped, inner fill clipped by the outer, leaf clipped by the inner.
    expect(instance(0, INSTANCE_CLIP)).toBe(-1)
    expect(instance(1, INSTANCE_CLIP)).toBe(0)
    expect(instance(2, INSTANCE_CLIP)).toBe(1)
  })

  it('leaves a frame stroke on the outer clip, so it is not cut by its own frame', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 100, height: 100 },
        fills: [fromHex('#ffffff')],
        strokes: [{ paint: fromHex('#ff0000'), weight: 8, align: 'outside' }],
      }),
    )
    document.insert(
      createRectangle({ size: { width: 20, height: 20 }, fills: [fromHex('#0a7cff')] }),
      frame.id,
    )
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    builder.sync(document, camera, viewport)
    const { instance } = read(stubbed)

    // Frame fill, child fill, frame stroke.
    expect(instance(0, INSTANCE_CLIP)).toBe(-1)
    expect(instance(1, INSTANCE_CLIP)).toBe(0)
    expect(instance(2, INSTANCE_CLIP)).toBe(-1)
  })
})

describe('text', () => {
  /*
   * A glyph reuses the slots a letter has no use for. Kind and the clip index stay where a
   * shape keeps them, because the shader reads both before it knows what it is looking at.
   */
  const GLYPH_FIELD = {
    u0: 12,
    kind: 13,
    v0: 14,
    u1: 15,
    clip: 16,
    v1: 17,
    pxRange: 18,
  } as const

  const KIND_GLYPH = 2

  /**
   * One text node at (100,50), 20px type. With the fixture font that makes a line 25 tall
   * with its baseline 20 down, every letter 10 wide, and each glyph's ink a 10 by 10 box
   * sitting 10 above the baseline.
   */
  function withText(characters = 'ab', fontSize = 20) {
    const document = new SceneDocument()
    const text = document.insert(
      createText({
        transform: translation(100, 50),
        characters,
        fontSize,
        fills: [fromHex('#ff0000')],
      }),
    )
    return { document, text }
  }

  function pack(document: SceneDocument) {
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    builder.sync(document, camera, viewport)
    return {
      builder,
      at: (index: number, slot: number) => instanceAt(stubbed.written(), STRIDE, index, slot),
    }
  }

  it('packs one instance per drawn glyph', () => {
    const { builder } = pack(withText('ab').document)
    expect(builder.count).toBe(2)
  })

  it('marks them as glyphs rather than as boxes', () => {
    const { at } = pack(withText('ab').document)
    expect(at(0, GLYPH_FIELD.kind)).toBe(KIND_GLYPH)
    expect(at(1, GLYPH_FIELD.kind)).toBe(KIND_GLYPH)
  })

  it('places each glyph quad against the baseline, in world space', () => {
    const { at } = pack(withText('ab').document)
    // Baseline 20 below the top, ink starting 10 above it, so 10 down from the node origin.
    expect(at(0, FIELD.originX)).toBe(100)
    expect(at(0, FIELD.originY)).toBe(60)
    expect(at(0, FIELD.width)).toBe(10)
    expect(at(0, FIELD.height)).toBe(10)
  })

  it('advances the pen between glyphs', () => {
    const { at } = pack(withText('ab').document)
    expect(at(1, FIELD.originX)).toBe(110)
    expect(at(1, FIELD.originY)).toBe(60)
  })

  it('starts a later line further down by one line height', () => {
    const { at } = pack(withText('a\nb').document)
    expect(at(0, FIELD.originY)).toBe(60)
    expect(at(1, FIELD.originY)).toBe(85)
  })

  it('carries the glyph rectangle of the atlas in the spare slots', () => {
    const { at } = pack(withText('a').document)
    expect(at(0, GLYPH_FIELD.u0)).toBe(0.25)
    expect(at(0, GLYPH_FIELD.v0)).toBe(0.5)
    expect(at(0, GLYPH_FIELD.u1)).toBeCloseTo(0.375, 6)
    expect(at(0, GLYPH_FIELD.v1)).toBe(0.75)
  })

  it('carries the distance range, so it cannot disagree with the atlas', () => {
    const { at } = pack(withText('a').document)
    expect(at(0, GLYPH_FIELD.pxRange)).toBe(4)
  })

  it('takes its colour from the first fill', () => {
    const { at } = pack(withText('a').document)
    expect(at(0, FIELD.red)).toBe(1)
    expect(at(0, FIELD.green)).toBe(0)
    expect(at(0, FIELD.alpha)).toBe(1)
  })

  it('advances for whitespace without packing anything for it', () => {
    const { builder, at } = pack(withText('a b').document)
    expect(builder.count).toBe(2)
    // 10 for the letter and 5 for the space, so the second letter starts 15 along.
    expect(at(1, FIELD.originX)).toBe(115)
  })

  it('packs nothing for an empty text node', () => {
    const { builder } = pack(withText('').document)
    expect(builder.count).toBe(0)
  })

  it('packs nothing for text with no fill', () => {
    const document = new SceneDocument()
    document.insert(createText({ characters: 'ab', fontSize: 20 }))
    expect(pack(document).builder.count).toBe(0)
  })

  it('substitutes the fallback glyph, so an uncovered character still draws', () => {
    const { builder, at } = pack(withText('中').document)
    expect(builder.count).toBe(1)
    expect(at(0, GLYPH_FIELD.kind)).toBe(KIND_GLYPH)
  })

  it('multiplies its alpha by the opacity it inherits', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ size: { width: 400, height: 400 }, opacity: 0.5, clipsContent: false }),
    )
    document.insert(
      createText({ characters: 'a', fontSize: 20, fills: [fromHex('#ff0000')] }),
      frame.id,
    )
    expect(pack(document).at(0, FIELD.alpha)).toBe(0.5)
  })

  it('answers to the clipping frame it sits inside', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 400, height: 400 },
        clipsContent: true,
        fills: [fromHex('#ffffff')],
      }),
    )
    document.insert(
      createText({ characters: 'a', fontSize: 20, fills: [fromHex('#ff0000')] }),
      frame.id,
    )
    const { at } = pack(document)
    // Instance 0 is the frame's own fill, which answers to no clip. The glyph follows.
    expect(at(0, GLYPH_FIELD.clip)).toBe(-1)
    expect(at(1, GLYPH_FIELD.clip)).toBe(0)
  })

  it('culls a glyph that is off screen', () => {
    const document = new SceneDocument()
    document.insert(
      createText({
        transform: translation(50_000, 50_000),
        characters: 'ab',
        fontSize: 20,
        fills: [fromHex('#ff0000')],
      }),
    )
    const { builder } = pack(document)
    expect(builder.count).toBe(0)
    expect(builder.culled).toBe(2)
  })

  /*
   * The reason glyphs share the shape buffer rather than getting a draw call of their own.
   * Painter's order is the instance order, so a rectangle inserted after a text node has to
   * land after its glyphs and therefore cover them.
   */
  it('interleaves with shapes in paint order rather than drawing above them all', () => {
    const document = new SceneDocument()
    const box = () =>
      createRectangle({ size: { width: 50, height: 50 }, fills: [fromHex('#0a7cff')] })
    document.insert(box())
    document.insert(createText({ characters: 'a', fontSize: 20, fills: [fromHex('#ff0000')] }))
    document.insert(box())

    const { builder, at } = pack(document)
    expect(builder.count).toBe(3)
    expect([at(0, FIELD.kind), at(1, FIELD.kind), at(2, FIELD.kind)]).toEqual([0, KIND_GLYPH, 0])
  })

  it('lays a node out again only when its text or size changes', () => {
    const stubbed = createStubDevice()
    const builder = build(stubbed)
    const { document, text } = withText('ab')

    builder.sync(document, camera, viewport)
    document.update(text.id, { opacity: 0.5 })
    builder.sync(document, camera, viewport)

    // Nothing to assert about the cache directly, so assert what it must not break: the
    // glyphs are still packed identically after a change that does not touch the text.
    expect(builder.count).toBe(2)
    expect(instanceAt(stubbed.written(), STRIDE, 1, FIELD.originX)).toBe(110)
  })
})
