import {
  IDENTITY,
  isPainted,
  multiply,
  type Mat2D,
  type PaintedNode,
  type SceneDocument,
  type SceneNode,
} from '@figma-canvas/document'

/** linear (4) + origin and size (4) + color (4) + params (4). */
const FLOATS_PER_INSTANCE = 16
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4

const KIND_RECTANGULAR = 0
const KIND_ELLIPTICAL = 1

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
  #version = -1

  constructor(device: GPUDevice) {
    this.#device = device
  }

  get count(): number {
    return this.#count
  }

  get buffer(): GPUBuffer | null {
    return this.#buffer
  }

  sync(document: SceneDocument): void {
    if (document.version === this.#version) return
    this.#version = document.version

    this.#count = 0
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

    if (isPainted(node) && node.fills[0]) this.#push(node, world, alpha)

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
