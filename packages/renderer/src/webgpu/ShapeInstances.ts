import {
  IDENTITY,
  applyToPoint,
  clipsChildren,
  drawnEffects,
  drawnPaints,
  drawnStrokes,
  invert,
  isPainted,
  multiply,
  paintColor,
  paintOpacity,
  resolveCornerRadii,
  shadowReach,
  strokeOffset,
  strokeOutset,
  transformRect,
  uniformCornerRadii,
  type CornerRadii,
  type DropShadow,
  type FontMetrics,
  type Mat2D,
  type Paint,
  type PaintedNode,
  type RGBA,
  type Rect,
  type SceneDocument,
  type SceneNode,
  type Stroke,
  type TextLayoutCache,
  type TextNode,
} from '@canvas/document'
import { viewMatrix, type Camera, type Viewport } from '../camera.js'
import { NO_CLIP, type ClipRegions } from './ClipRegions.js'
import { NO_GRADIENT, type GradientRamps } from './GradientRamps.js'
import {
  BIT_GRADIENT,
  BIT_SHADOW,
  BYTES_PER_INSTANCE,
  FLOATS_PER_INSTANCE,
} from './instanceLayout.js'

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

const SQUARE_CORNERS = uniformCornerRadii()

/** An ellipse has no corners to round: its shape comes entirely from its kind. */
function cornerRadiiOf(node: BoxNode): CornerRadii {
  return node.type === 'ellipse' ? SQUARE_CORNERS : node.cornerRadii
}

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
  #ramps: GradientRamps
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
    ramps: GradientRamps,
    metrics: FontMetrics,
    layouts: TextLayoutCache,
  ) {
    this.#device = device
    this.#clips = clips
    this.#ramps = ramps
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
    // Cleared exactly where the clips are, and for the same reason: both tables describe
    // this build of the buffer and nothing else.
    this.#ramps.reset()
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
    this.#ramps.upload()
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
    // Shadows first, so painter's order puts them behind everything of this node: its fill,
    // its subtree and its stroke. They still land after earlier siblings, which is where a
    // drop shadow composites in Figma too: under the node, over what the node sits on.
    // Code nodes have no `effects` field: their output is generated, not styled by hand, and
    // a shadow is out of scope for what running source can express.
    const shadowed = painted && painted.type !== 'code' ? painted : null
    if (shadowed) {
      for (const shadow of drawnEffects(shadowed.effects)) {
        this.#submitShadow(shadowed, world, alpha, shadow, clip)
      }
    }
    // One instance per fill, back to front, so painter's order composites the stack with no
    // second pass and no blending to arrange. The frame's own paint answers to the clip it
    // sits in, not to its own: a frame does not clip itself, which is what lets an outward
    // stroke on a clipping frame still show.
    if (painted) {
      for (const fill of drawnPaints(painted.fills)) {
        this.#submit(painted, world, alpha * paintOpacity(fill), fill, clip)
      }
    }

    const inner = clipsChildren(node)
      ? this.#clips.push(world, node.size, node.cornerRadii, clip)
      : clip

    for (const child of document.getChildren(node.id)) {
      this.#collect(document, child, world, alpha, inner)
    }

    // After the children, so a frame's stroke sits above its contents rather than being
    // painted over by them. A leaf has no children, so for a rectangle or an ellipse this is
    // the same position it would have had before the loop.
    if (painted) {
      for (const stroke of drawnStrokes(painted.strokes)) {
        const paint = stroke.paint
        this.#submit(painted, world, alpha * paintOpacity(paint), paint, clip, stroke)
      }
    }
  }

  /**
   * One instance per drawn glyph.
   *
   * Every glyph of a node shares that node's world transform, so the linear part is written
   * unchanged and only the origin moves: the glyph's own quad is positioned in the node's
   * local space and then carried out to world. That is what makes a rotated or scaled text
   * node work without the packing knowing either happened.
   *
   * A stack of fills is a whole pass of glyphs per paint rather than a paint per glyph, so
   * the second colour lands over the entire word. Interleaving them would put one letter's
   * top paint under the next letter's bottom one, which only shows where glyphs overlap and
   * is therefore exactly the kind of thing that would be found by accident in a script face.
   */
  #submitText(node: TextNode, world: Mat2D, alpha: number, clip: number): void {
    const fills = drawnPaints(node.fills)
    if (fills.length === 0) return

    const layout = this.#layouts.layoutFor(node, this.#metrics)

    for (const fill of fills) {
      const paintAlpha = alpha * paintOpacity(fill)
      // A glyph's spare slots carry its patch of the atlas, so there is nowhere to put a
      // gradient index: a gradient fill on text draws as a solid of its first stop.
      const color = paintColor(fill)
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

          this.#pushGlyph(world, box, color, paintAlpha, quad.uv, clip)
        }
      }
    }
  }

  /**
   * The same 96 bytes a shape uses, with the slots a letter has no use for carrying its
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
    // The feature bitfield, read as a u32 by the shader. Bit 0 will mean the paint is a
    // gradient and bit 1 that the instance is a drop shadow; a glyph is neither.
    this.#data[at + 19] = 0

    // A letter has no corners to round. Written rather than skipped because the backing
    // array outlives a build, so an unwritten slot would carry whatever the shape that last
    // occupied this index left in it.
    this.#data[at + 20] = 0
    this.#data[at + 21] = 0
    this.#data[at + 22] = 0
    this.#data[at + 23] = 0

    this.#count += 1
  }

  /** Culls against the region the buffer was built for, then packs what survives. */
  #submit(
    node: BoxNode,
    world: Mat2D,
    alpha: number,
    paint: Paint,
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
    this.#push(node, world, alpha, paint, clip, stroke)
  }

  #push(
    node: BoxNode,
    world: Mat2D,
    alpha: number,
    paint: Paint,
    clip: number,
    stroke?: Stroke,
  ): void {
    this.#reserve(this.#count + 1)
    const at = this.#count * FLOATS_PER_INSTANCE
    // Pushed after the cull, so an off-screen gradient costs the table nothing.
    const gradient = paint.type === 'solid' ? NO_GRADIENT : this.#ramps.push(paint)
    const color = paintColor(paint)

    this.#data[at + 0] = world.a
    this.#data[at + 1] = world.b
    this.#data[at + 2] = world.c
    this.#data[at + 3] = world.d

    this.#data[at + 4] = world.tx
    this.#data[at + 5] = world.ty
    this.#data[at + 6] = node.size.width
    this.#data[at + 7] = node.size.height

    // For a gradient the colour slot still carries a real colour, the first stop's, so the
    // slot means something on every instance and is a sensible fallback if the bit is ever
    // unset. Its alpha is the inherited one alone: each stop carries its own alpha in the
    // ramp, and the shader multiplies the two, which is how a solid composes them too.
    this.#data[at + 8] = color.r
    this.#data[at + 9] = color.g
    this.#data[at + 10] = color.b
    this.#data[at + 11] = paint.type === 'solid' ? color.a * alpha : alpha

    // The gradient's index in the ramps table, or NO_GRADIENT for a solid.
    this.#data[at + 12] = gradient
    this.#data[at + 13] = node.type === 'ellipse' ? KIND_ELLIPTICAL : KIND_RECTANGULAR
    // Weight 0 marks a fill. Anything above it is a band around the shape's edge, and the
    // offset says where that band sits relative to the edge.
    this.#data[at + 14] = stroke ? stroke.weight : 0
    this.#data[at + 15] = stroke ? strokeOffset(stroke) : 0

    // Which clipping frame this instance answers to, or NO_CLIP. The other three floats are
    // padding the vertex format needs anyway, so the next per instance flag is free.
    this.#data[at + 16] = clip
    // A drop shadow's blur and spread; zero on everything that is not one.
    this.#data[at + 17] = 0
    this.#data[at + 18] = 0
    // The feature bitfield, read as a u32 by the shader. Bit 0 means the paint is a
    // gradient; bit 1, set only in #pushShadow, that the instance is a drop shadow.
    this.#data[at + 19] = gradient === NO_GRADIENT ? 0 : BIT_GRADIENT

    // Resolved here rather than in the shader: resolution needs all four radii and both
    // sides at once, gives the same answer for every pixel, and is what makes the packer,
    // the clip table and hit testing agree instead of clamping three separate ways.
    const radii = resolveCornerRadii(node.size, cornerRadiiOf(node))
    this.#data[at + 20] = radii.topLeft
    this.#data[at + 21] = radii.topRight
    this.#data[at + 22] = radii.bottomRight
    this.#data[at + 23] = radii.bottomLeft

    this.#count += 1
  }

  /**
   * Culls a shadow against its own reach in its own place, which is not the node's: the
   * offset moves it and blur plus spread grow it, so a shadow can be on screen while its
   * node is not.
   */
  #submitShadow(
    node: BoxNode,
    world: Mat2D,
    alpha: number,
    shadow: DropShadow,
    clip: number,
  ): void {
    const shadowWorld = this.#offsetWorld(world, shadow)
    const reach = shadowReach(shadow)
    const bounds = transformRect(shadowWorld, {
      x: -reach,
      y: -reach,
      width: node.size.width + reach * 2,
      height: node.size.height + reach * 2,
    })

    if (!this.#coverage || !intersects(this.#coverage, bounds)) {
      this.#culled += 1
      return
    }
    this.#pushShadow(node, shadowWorld, alpha, shadow, clip)
  }

  /**
   * The offset goes in the transform, not in the quad padding. Both padding computations,
   * `outset()` in the vertex stage and the reach above, assume uniform four-side padding,
   * and an offset is directional: folding it in here leaves both untouched. Pushed through
   * the world's linear part so it is in the node's own units, turning and scaling with the
   * node the way its stroke does.
   */
  #offsetWorld(world: Mat2D, shadow: DropShadow): Mat2D {
    return {
      ...world,
      tx: world.tx + world.a * shadow.offset.x + world.c * shadow.offset.y,
      ty: world.ty + world.b * shadow.offset.x + world.d * shadow.offset.y,
    }
  }

  /**
   * A shadow is a third instance kind alongside fill and stroke: same size, same radii, the
   * transform translated by the offset, the shadow's own colour, bit 1 set, and blur and
   * spread in the two flags slots a box instance never used. The SDF gives it nearly free.
   */
  #pushShadow(
    node: BoxNode,
    world: Mat2D,
    alpha: number,
    shadow: DropShadow,
    clip: number,
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

    this.#data[at + 8] = shadow.color.r
    this.#data[at + 9] = shadow.color.g
    this.#data[at + 10] = shadow.color.b
    this.#data[at + 11] = shadow.color.a * alpha

    this.#data[at + 12] = NO_GRADIENT
    this.#data[at + 13] = node.type === 'ellipse' ? KIND_ELLIPTICAL : KIND_RECTANGULAR
    this.#data[at + 14] = 0
    this.#data[at + 15] = 0

    this.#data[at + 16] = clip
    this.#data[at + 17] = shadow.blur
    this.#data[at + 18] = shadow.spread
    this.#data[at + 19] = BIT_SHADOW

    const radii = resolveCornerRadii(node.size, cornerRadiiOf(node))
    this.#data[at + 20] = radii.topLeft
    this.#data[at + 21] = radii.topRight
    this.#data[at + 22] = radii.bottomRight
    this.#data[at + 23] = radii.bottomLeft

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
