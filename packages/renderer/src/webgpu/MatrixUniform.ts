import type { Mat2D } from '@canvas/document'

/**
 * 3 columns of 4 floats. A mat3x3f is 3 vec3f columns, but a vec3f is aligned to 16 bytes
 * in a uniform buffer, so each column is padded to 4 floats and the last one is skipped.
 * Getting this wrong produces a sheared or blank image rather than an error, which is the
 * single most common WebGPU mistake.
 */
const FLOATS = 12
const BYTES = FLOATS * 4

/** One layout, shared by every matrix uniform in the renderer. */
export function createMatrixBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'matrix',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
  })
}

/**
 * A single affine matrix the shaders read as a mat3x3f.
 *
 * There are two of these: world to clip for the document, and pixels to clip for the
 * selection overlay. Sharing one class is what makes the second one free.
 */
export class MatrixUniform {
  #device: GPUDevice
  #buffer: GPUBuffer
  #data = new Float32Array(FLOATS)

  readonly bindGroup: GPUBindGroup

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, label: string) {
    this.#device = device
    this.#buffer = device.createBuffer({
      label,
      size: BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.bindGroup = device.createBindGroup({
      label,
      layout,
      entries: [{ binding: 0, resource: { buffer: this.#buffer } }],
    })
  }

  update(m: Mat2D): void {
    // Column major, each column padded to 16 bytes.
    this.#data[0] = m.a
    this.#data[1] = m.b
    this.#data[2] = 0

    this.#data[4] = m.c
    this.#data[5] = m.d
    this.#data[6] = 0

    this.#data[8] = m.tx
    this.#data[9] = m.ty
    this.#data[10] = 1

    this.#device.queue.writeBuffer(this.#buffer, 0, this.#data)
  }

  destroy(): void {
    this.#buffer.destroy()
  }
}
