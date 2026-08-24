import {
  invert,
  resolveCornerRadii,
  type CornerRadii,
  type Mat2D,
  type Size,
} from '@canvas/document'

/**
 * Four `vec4f`, laid out to mirror a shape instance so one mental model covers both: the
 * linear part of a transform, then origin and size, then the four corner radii, then the
 * index of the enclosing clip.
 *
 * Nothing forces the transform to be a `mat3x3f`, whose 16 byte column stride would waste
 * five of these floats on padding, and the shader already builds a matrix from vectors in
 * the vertex stage. 64 bytes either way; this way none of it is padding.
 */
const FLOATS_PER_CLIP = 16
const BYTES_PER_CLIP = FLOATS_PER_CLIP * 4

/** The chain terminator. A clip with no parent is the outermost one. */
export const NO_CLIP = -1

/** One layout for the clip table, held by the shape pipeline alone. */
export function createClipBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'clips',
    entries: [
      {
        binding: 0,
        // Read per pixel, not per vertex: whether a fragment survives depends on where that
        // fragment is, not where the quad's corners are.
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
    ],
  })
}

/**
 * Every clipping frame currently in view, as a table the fragment shader indexes into.
 *
 * A clip is stored as the inverse of the frame's world transform rather than the transform
 * itself, because the shader's job is the opposite of the vertex stage's: it takes a world
 * position and asks where that lands inside the frame. Inverting once per frame on the CPU
 * beats inverting per pixel.
 *
 * Each record names its enclosing clip, so nesting is a chain the shader walks rather than
 * an intersection the CPU has to precompute. That is what keeps it correct when a scaled
 * frame sits inside another one, where an intersection of screen rectangles would not be.
 */
export class ClipRegions {
  #device: GPUDevice
  #layout: GPUBindGroupLayout
  #buffer: GPUBuffer | null = null
  #bindGroup: GPUBindGroup | null = null
  #capacity = 0
  #data = new Float32Array(0)
  #count = 0

  constructor(device: GPUDevice, layout: GPUBindGroupLayout) {
    this.#device = device
    this.#layout = layout
    // Bound even when nothing clips, because a pipeline's bind groups are not optional.
    this.#reserve(1)
  }

  get count(): number {
    return this.#count
  }

  get bindGroup(): GPUBindGroup | null {
    return this.#bindGroup
  }

  reset(): void {
    this.#count = 0
  }

  /** Returns the index to hand to everything drawn inside this frame. */
  push(world: Mat2D, size: Size, radii: CornerRadii, parent: number): number {
    this.#reserve(this.#count + 1)
    const at = this.#count * FLOATS_PER_CLIP
    const m = invert(world)

    this.#data[at + 0] = m.a
    this.#data[at + 1] = m.b
    this.#data[at + 2] = m.c
    this.#data[at + 3] = m.d

    this.#data[at + 4] = m.tx
    this.#data[at + 5] = m.ty
    this.#data[at + 6] = size.width
    this.#data[at + 7] = size.height

    // Resolved on the same terms the packer resolves a shape's, so a frame clips to exactly
    // the outline it draws.
    const resolved = resolveCornerRadii(size, radii)
    this.#data[at + 8] = resolved.topLeft
    this.#data[at + 9] = resolved.topRight
    this.#data[at + 10] = resolved.bottomRight
    this.#data[at + 11] = resolved.bottomLeft

    this.#data[at + 12] = parent
    this.#data[at + 13] = 0
    this.#data[at + 14] = 0
    this.#data[at + 15] = 0

    this.#count += 1
    return this.#count - 1
  }

  upload(): void {
    if (!this.#buffer || this.#count === 0) return
    this.#device.queue.writeBuffer(
      this.#buffer,
      0,
      this.#data.buffer,
      this.#data.byteOffset,
      this.#count * BYTES_PER_CLIP,
    )
  }

  #reserve(needed: number): void {
    if (needed <= this.#capacity) return
    const capacity = Math.max(8, this.#capacity * 2, needed)
    const data = new Float32Array(capacity * FLOATS_PER_CLIP)
    data.set(this.#data)
    this.#data = data
    this.#capacity = capacity

    this.#buffer?.destroy()
    this.#buffer = this.#device.createBuffer({
      label: 'clip regions',
      size: capacity * BYTES_PER_CLIP,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    // A bind group names a buffer, so a grown buffer needs a new one.
    this.#bindGroup = this.#device.createBindGroup({
      label: 'clips',
      layout: this.#layout,
      entries: [{ binding: 0, resource: { buffer: this.#buffer } }],
    })
  }

  destroy(): void {
    this.#buffer?.destroy()
    this.#buffer = null
    this.#bindGroup = null
  }
}
