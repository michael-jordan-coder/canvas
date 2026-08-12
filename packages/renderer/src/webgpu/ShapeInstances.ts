import {
  IDENTITY,
  invert,
  isPainted,
  multiply,
  transformRect,
  type Mat2D,
  type PaintedNode,
  type Rect,
  type SceneDocument,
  type SceneNode,
} from '@figma-canvas/document'
import { viewMatrix, type Camera, type Viewport } from '../camera.js'

/** linear (4) + origin and size (4) + color (4) + params (4). */
const FLOATS_PER_INSTANCE = 16
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4

const KIND_RECTANGULAR = 0
const KIND_ELLIPTICAL = 1

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
  #buffer: GPUBuffer | null = null
  #capacity = 0
  #data = new Float32Array(0)
  #count = 0
  #culled = 0
  #version = -1
  /** The world region the current buffer was built for, viewport plus margin. */
  #coverage: Rect | null = null

  constructor(device: GPUDevice) {
    this.#device = device
  }

  get count(): number {
    return this.#count
  }

  /** Nodes skipped as off screen by the last build. */
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

    // Depth first from the root, accumulating the transform on the way down. Asking the
    // document for each node's world transform separately would walk back up to the root
    // once per node, turning an O(n) pass into O(n * depth).
    for (const child of document.getChildren(document.rootId)) {
      this.#collect(document, child, IDENTITY, 1)
    }

    this.#upload()
  }

  #collect(document: SceneDocument, node: SceneNode, parent: Mat2D, opacity: number): void {
    // A hidden node hides its children with it.
    if (!node.visible) return

    // The node's own transform applies before its parent's.
    const world = multiply(node.transform, parent)
    const alpha = opacity * node.opacity

    if (isPainted(node) && node.fills[0]) {
      // Tested per node rather than per subtree, because `clipsContent` is not honoured yet
      // and a child may sit well outside the bounds of its parent.
      const bounds = transformRect(world, {
        x: 0,
        y: 0,
        width: node.size.width,
        height: node.size.height,
      })
      if (this.#coverage && intersects(this.#coverage, bounds)) this.#push(node, world, alpha)
      else this.#culled += 1
    }

    for (const child of document.getChildren(node.id)) {
      this.#collect(document, child, world, alpha)
    }
  }

  #push(node: PaintedNode, world: Mat2D, alpha: number): void {
    const fill = node.fills[0]
    if (!fill) return

    this.#reserve(this.#count + 1)
    const at = this.#count * FLOATS_PER_INSTANCE
    const { color } = fill

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
    this.#data[at + 14] = 0
    this.#data[at + 15] = 0

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
