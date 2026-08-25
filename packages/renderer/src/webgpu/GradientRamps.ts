import { MAX_GRADIENT_STOPS, type GradientPaint } from '@canvas/document'

/**
 * Every gradient packed this frame, as one storage buffer the fragment shader indexes into.
 *
 * Stops are variable length, which no 96 byte instance can hold, so the instance carries an
 * index and the data lives here, following the `ClipRegions` precedent. The alternative,
 * baking each ramp into a 1D texture, is the wrong trade: it needs a texture per distinct
 * gradient, re-baked on every stop edit, and it quantizes a ramp that this walk evaluates
 * exactly.
 *
 * The buffer is a stream of 8 float records, viewed by the shader as `array<vec4f>`:
 *
 *   Gradient:  from (vec2f), to (vec2f) | stopStart (f32), stopCount (f32), kind (f32), pad
 *   Stop:      color (vec4f)            | position (f32), pad (vec3f)
 *
 * A gradient is its header followed immediately by its stops, and the index handed to the
 * instance is the header's position in vec4s. A stop's padding is the honest cost of a
 * `vec4f` array; packing two stops per record to avoid it would buy 12 bytes with indexing
 * arithmetic in the walk.
 */
const FLOATS_PER_RECORD = 8
const VEC4S_PER_RECORD = 2

const KIND_LINEAR = 0
const KIND_RADIAL = 1

/** What the gradient slot holds when the paint is a solid. */
export const NO_GRADIENT = -1

export class GradientRamps {
  #device: GPUDevice
  #buffer: GPUBuffer | null = null
  #capacity = 0
  #data = new Float32Array(0)
  /** In records of 8 floats. A gradient occupies 1 + stopCount of them. */
  #count = 0

  constructor(device: GPUDevice) {
    this.#device = device
    // Bound even when nothing is a gradient, because a pipeline's bind groups are not
    // optional and the layout names this buffer whether or not any instance indexes it.
    this.#reserve(1)
  }

  get count(): number {
    return this.#count
  }

  get buffer(): GPUBuffer | null {
    return this.#buffer
  }

  reset(): void {
    this.#count = 0
  }

  /** Returns the index to write into the instance's gradient slot. */
  push(paint: GradientPaint): number {
    // The parser and the panel both cap the stop count; this is the last line of defence,
    // for the same reason the shader bounds its walk.
    const stops = paint.stops.slice(0, MAX_GRADIENT_STOPS)
    this.#reserve(this.#count + 1 + stops.length)

    const at = this.#count * FLOATS_PER_RECORD
    const header = this.#count * VEC4S_PER_RECORD

    this.#data[at + 0] = paint.from.x
    this.#data[at + 1] = paint.from.y
    this.#data[at + 2] = paint.to.x
    this.#data[at + 3] = paint.to.y

    this.#data[at + 4] = header + VEC4S_PER_RECORD
    this.#data[at + 5] = stops.length
    this.#data[at + 6] = paint.type === 'radial' ? KIND_RADIAL : KIND_LINEAR
    this.#data[at + 7] = 0

    for (let index = 0; index < stops.length; index += 1) {
      const stop = stops[index]!
      const base = at + (index + 1) * FLOATS_PER_RECORD
      // The stop's own alpha only. The paint's opacity and the alpha inherited from the
      // tree ride in the instance's colour slot, and the shader multiplies the two, so the
      // three compose exactly as they do for a solid.
      this.#data[base + 0] = stop.color.r
      this.#data[base + 1] = stop.color.g
      this.#data[base + 2] = stop.color.b
      this.#data[base + 3] = stop.color.a
      this.#data[base + 4] = stop.position
      this.#data[base + 5] = 0
      this.#data[base + 6] = 0
      this.#data[base + 7] = 0
    }

    this.#count += 1 + stops.length
    return header
  }

  upload(): void {
    if (!this.#buffer || this.#count === 0) return
    this.#device.queue.writeBuffer(
      this.#buffer,
      0,
      this.#data.buffer,
      this.#data.byteOffset,
      this.#count * FLOATS_PER_RECORD * 4,
    )
  }

  #reserve(needed: number): void {
    if (needed <= this.#capacity) return
    const capacity = Math.max(8, this.#capacity * 2, needed)
    const data = new Float32Array(capacity * FLOATS_PER_RECORD)
    data.set(this.#data)
    this.#data = data
    this.#capacity = capacity

    // A grown buffer is a new buffer, which invalidates the bind group naming it. The
    // renderer watches the buffer's identity and rebuilds the shared group, since clips
    // share that group and neither table can own it alone.
    this.#buffer?.destroy()
    this.#buffer = this.#device.createBuffer({
      label: 'gradient ramps',
      size: capacity * FLOATS_PER_RECORD * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }

  destroy(): void {
    this.#buffer?.destroy()
    this.#buffer = null
  }
}
