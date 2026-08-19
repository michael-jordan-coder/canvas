import {
  IDENTITY,
  activeStroke,
  applyToPoint,
  invert,
  isPainted,
  multiply,
  strokeOffset,
  strokeOutset,
  transformRect,
  type FontMetrics,
  type Mat2D,
  type PaintedNode,
  type RGBA,
  type Rect,
  type SceneDocument,
  type SceneNode,
  type Stroke,
  type TextLayoutCache,
  type TextNode,
} from '@figma-canvas/document'
import { viewMatrix, type Camera, type Viewport } from '../camera.js'
import { NO_CLIP, type ClipRegions } from './ClipRegions.js'

/** linear (4) + origin and size (4) + colour (4) + params (4) + flags (4). */
const FLOATS_PER_INSTANCE = 20
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4

const KIND_RECTANGULAR = 0
const KIND_ELLIPTICAL = 1
const KIND_GLYPH = 2

/**
 * The painted nodes that are a single box, which is every one of them except text.
 *
 * Text is the odd one out: it packs one instance per glyph, each with its own quad and its
 * own patch of the atlas, so it never reaches `#submit`. Naming the difference in a type
 * keeps the box path from having to answer questions a glyph would ask, such as what corner
 * radius a letter has.
 */
type BoxNode = Exclude<PaintedNode, TextNode>

/**
 * How far past the viewport the build reaches, as a fraction of it.
 *
 * Culling and caching pull against each other: the buffer is cached against the document
 * version so panning costs nothing, but a culled buffer depends on where the camera is. The
 * margin buys back most of that. A pan stays free until it leaves the built region, and only
 * then is there a rebuild.
 */
const CULL_MARGIN = 0.5

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  )
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/** The viewport as a rect in world space. */
function worldView(camera: Camera, viewport: Viewport): Rect {
  return transformRect(invert(viewMatrix(camera, viewport)), {
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  })
}

function expand(rect: Rect, fraction: number): Rect {
  const x = rect.width * fraction
  const y = rect.height * fraction
  return {
    x: rect.x - x,
    y: rect.y - y,
    width: rect.width + x * 2,
    height: rect.height + y * 2,
  }
}

/**
 * The document, flattened into one buffer the GPU can draw in a single call.
 *
 * Rebuilt only when the document version changes, so panning and zooming never touch it.
 * That is the whole point of keeping the camera in a uniform: moving the view is free,
 * changing the scene is the only thing that costs an upload.
 */
export class ShapeInstances {
  #device: GPUDevice
  #clips: ClipRegions
  #buffer: GPUBuffer | null = null
  #capacity = 0
  #data = new Float32Array(0)
  #count = 0
  #culled = 0
  #version = -1
  /** The world region the current buffer was built for, viewport plus margin. */
  #coverage: Rect | null = null
  #metrics: FontMetrics
  /*
   * Shared with the overlay and the editor, so a caret is placed against the very layout its
   * glyphs were packed from. A rebuild happens for any document change at all, so without a
   * cache of some kind, nudging one rectangle would re-lay out every paragraph on the page.
   */
  #layouts: TextLayoutCache

  constructor(
    device: GPUDevice,
    clips: ClipRegions,
    metrics: FontMetrics,
    layouts: TextLayoutCache,
  ) {
    this.#device = device
    this.#clips = clips
    this.#metrics = metrics
    this.#layouts = layouts
  }

  get count(): number {
    return this.#count
  }

  /** Instances skipped as off screen by the last build. A stroke counts separately from its fill. */
  get culled(): number {
    return this.#culled
  }

  get buffer(): GPUBuffer | null {
    return this.#buffer
  }

  sync(document: SceneDocument, camera: Camera, viewport: Viewport): void {
    const view = worldView(camera, viewport)
    const unchanged = document.version === this.#version
    // Still inside the region the current buffer was built for, so nothing to do. This is
    // what keeps an ordinary pan free even though the contents depend on the camera.
    if (unchanged && this.#coverage && contains(this.#coverage, view)) return

    this.#version = document.version
    this.#coverage = expand(view, CULL_MARGIN)
    this.#count = 0
    this.#culled = 0
    this.#clips.reset()
    // This walk is the only one that visits every node, so it is what ages the layout cache.
    this.#layouts.sweep()

    // Depth first from the root, accumulating the transform on the way down. Asking the
    // document for each node's world transform separately would walk back up to the root
    // once per node, turning an O(n) pass into O(n * depth).
    for (const child of document.getChildren(document.rootId)) {
      this.#collect(document, child, IDENTITY, 1, NO_CLIP)
    }

    this.#upload()
    this.#clips.upload()
  }

  #collect(
    document: SceneDocument,
    node: SceneNode,
    parent: Mat2D,
    opacity: number,
    clip: number,
  ): void {
    // A hidden node hides its children with it.
    if (!node.visible) return

    // The node's own transform applies before its parent's.
    const world = multiply(node.transform, parent)
    const alpha = opacity * node.opacity

    // Text is packed as one instance per glyph rather than as a box, at exactly the point in
    // the walk a shape would have contributed its fill, so it keeps its place in the order.
    if (node.type === 'text') this.#submitText(node, world, alpha, clip)

    const painted = isPainted(node) && node.type !== 'text' ? node : null
    const fill = painted?.fills[0]
    // The frame's own paint answers to the clip it sits in, not to its own. A frame does not
    // clip itself, which is what lets an outward stroke on a clipping frame still show.
    if (painted && fill) this.#submit(painted, world, alpha, fill.color, clip)

    const inner =
      node.type === 'frame' && node.clipsContent
        ? this.#clips.push(world, node.size, node.cornerRadius, clip)
        : clip

    for (const child of document.getChildren(node.id)) {
      this.#collect(document, child, world, alpha, inner)
    }

    // After the children, so a frame's stroke sits above its contents rather than being
    // painted over by them. A leaf has no children, so for a rectangle or an ellipse this is
    // the same position it would have had before the loop.
    const stroke = painted ? activeStroke(painted.strokes) : undefined
    if (painted && stroke) this.#submit(painted, world, alpha, stroke.paint.color, clip, stroke)
  }

  /**
   * One instance per drawn glyph.
   *
   * Every glyph of a node shares that node's world transform, so the linear part is written
   * unchanged and only the origin moves: the glyph's own quad is positioned in the node's
   * local space and then carried out to world. That is what makes a rotated or scaled text
   * node work without the packing knowing either happened.
   */
  #submitText(node: TextNode, world: Mat2D, alpha: number, clip: number): void {
    const fill = node.fills[0]
    if (!fill) return

    const layout = this.#layouts.layoutFor(node, this.#metrics)

    for (const line of layout.lines) {
      for (const placed of line.glyphs) {
        // Whitespace advances the pen and has nothing to draw.
        const quad = this.#metrics.glyphs.get(placed.code)?.quad
        if (!quad) continue

        // The plane bounds are in em from the pen position on the baseline, and both they
        // and the baseline are y-down, so this is a scale and an offset with no flip.
        const box = {
          x: placed.x + quad.plane.x * node.fontSize,
          y: line.baseline + quad.plane.y * node.fontSize,
          width: quad.plane.width * node.fontSize,
          height: quad.plane.height * node.fontSize,
        }

        if (!this.#coverage || !intersects(this.#coverage, transformRect(world, box))) {
          this.#culled += 1
          continue
        }

        this.#pushGlyph(world, box, fill.color, alpha, quad.uv, clip)
      }
    }
  }

  /**
   * The same 80 bytes a shape uses, with the slots a letter has no use for carrying its
   * patch of the atlas instead. Kind and clip index stay where they are, because the shader
   * reads those without knowing yet what it is looking at.
   */
  #pushGlyph(
    world: Mat2D,
    box: Rect,
    color: RGBA,
    alpha: number,
    uv: Rect,
    clip: number,
  ): void {
    this.#reserve(this.#count + 1)
    const at = this.#count * FLOATS_PER_INSTANCE
    // Where the glyph's own quad starts, carried out of the node's space into the world.
    const origin = applyToPoint(world, { x: box.x, y: box.y })

    this.#data[at + 0] = world.a
    this.#data[at + 1] = world.b
    this.#data[at + 2] = world.c
    this.#data[at + 3] = world.d

    this.#data[at + 4] = origin.x
    this.#data[at + 5] = origin.y
    this.#data[at + 6] = box.width
    this.#data[at + 7] = box.height

    this.#data[at + 8] = color.r
    this.#data[at + 9] = color.g
    this.#data[at + 10] = color.b
    this.#data[at + 11] = color.a * alpha

    // Where a shape keeps its corner radius, stroke weight and stroke offset: the left, top
    // and right edges of this glyph in the atlas.
    this.#data[at + 12] = uv.x
    this.#data[at + 13] = KIND_GLYPH
    this.#data[at + 14] = uv.y
    this.#data[at + 15] = uv.x + uv.width

    this.#data[at + 16] = clip
    this.#data[at + 17] = uv.y + uv.height
    // Carried per instance rather than in a uniform, so the field width can never disagree
    // with the atlas the coordinates above point into.
    this.#data[at + 18] = this.#metrics.pxRange
    this.#data[at + 19] = 0

    this.#count += 1
  }

  /** Culls against the region the buffer was built for, then packs what survives. */
  #submit(
    node: BoxNode,
    world: Mat2D,
    alpha: number,
    color: RGBA,
    clip: number,
    stroke?: Stroke,
  ): void {
    // An outward stroke covers more ground than the node's own box, so it is culled against
    // its own bounds rather than the node's. Tested per instance rather than per subtree,
    // because a child may sit well outside the bounds of its parent unless the parent clips.
    const pad = stroke ? strokeOutset(stroke) : 0
    const bounds = transformRect(world, {
      x: -pad,
      y: -pad,
      width: node.size.width + pad * 2,
      height: node.size.height + pad * 2,
    })

    if (!this.#coverage || !intersects(this.#coverage, bounds)) {
      this.#culled += 1
      return
    }
    this.#push(node, world, alpha, color, clip, stroke)
  }

  #push(
    node: BoxNode,
    world: Mat2D,
    alpha: number,
    color: RGBA,
    clip: number,
    stroke?: Stroke,
  ): void {
    this.#reserve(this.#count + 1)
    const at = this.#count * FLOATS_PER_INSTANCE

    this.#data[at + 0] = world.a
    this.#data[at + 1] = world.b
    this.#data[at + 2] = world.c
    this.#data[at + 3] = world.d

    this.#data[at + 4] = world.tx
    this.#data[at + 5] = world.ty
    this.#data[at + 6] = node.size.width
    this.#data[at + 7] = node.size.height

    this.#data[at + 8] = color.r
    this.#data[at + 9] = color.g
    this.#data[at + 10] = color.b
    this.#data[at + 11] = color.a * alpha

    this.#data[at + 12] = node.type === 'ellipse' ? 0 : node.cornerRadius
    this.#data[at + 13] = node.type === 'ellipse' ? KIND_ELLIPTICAL : KIND_RECTANGULAR
    // Weight 0 marks a fill. Anything above it is a band around the shape's edge, and the
    // offset says where that band sits relative to the edge.
    this.#data[at + 14] = stroke ? stroke.weight : 0
    this.#data[at + 15] = stroke ? strokeOffset(stroke) : 0

    // Which clipping frame this instance answers to, or NO_CLIP. The other three floats are
    // padding the vertex format needs anyway, so the next per instance flag is free.
    this.#data[at + 16] = clip
    this.#data[at + 17] = 0
    this.#data[at + 18] = 0
    this.#data[at + 19] = 0

    this.#count += 1
  }

  /** Grows geometrically, so a document being built up node by node does not reallocate on every insert. */
  #reserve(needed: number): void {
    if (needed <= this.#capacity) return
    const capacity = Math.max(64, this.#capacity * 2, needed)
    const data = new Float32Array(capacity * FLOATS_PER_INSTANCE)
    data.set(this.#data)
    this.#data = data
    this.#capacity = capacity
    this.#buffer?.destroy()
    this.#buffer = this.#device.createBuffer({
      label: 'shape instances',
      size: capacity * BYTES_PER_INSTANCE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }

  #upload(): void {
    if (!this.#buffer || this.#count === 0) return
    this.#device.queue.writeBuffer(
      this.#buffer,
      0,
      this.#data.buffer,
      this.#data.byteOffset,
      this.#count * BYTES_PER_INSTANCE,
    )
  }

  destroy(): void {
    this.#buffer?.destroy()
    this.#buffer = null
  }
}
