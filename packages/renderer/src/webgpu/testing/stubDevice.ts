/**
 * A fake GPUDevice, enough to test the instance builders without a GPU.
 *
 * They only ever create buffers and bind groups and call `queue.writeBuffer`, so capturing
 * the last of those gives the exact bytes the GPU would have received. This is what makes
 * packing bugs catchable: a wrong offset or a missing field shows up as a number in the
 * wrong slot rather than as a shape drawn in the wrong place.
 *
 * Uploads are kept per buffer label, because more than one builder writes during a single
 * sync and a single slot would only ever hold whichever went last.
 */
export interface StubDevice {
  device: GPUDevice
  /** The most recent upload to the named buffer, as floats. */
  written(label?: string): Float32Array
  /** Every texture created on this device, in order, as the descriptors it was asked for. */
  textures(): readonly GPUTextureDescriptor[]
  /**
   * Every render pipeline created on this device, as the descriptors it was asked for.
   *
   * A pipeline is pure declaration: the vertex layout that says where each packed slot
   * starts and the blend state that says how a fragment reaches the surface. Both fail
   * silently on a real GPU, as a shape reading the wrong bytes or an edge composited
   * slightly wrong, so the descriptor is the thing worth pinning.
   */
  pipelines(): readonly GPURenderPipelineDescriptor[]
  /** Every shader module created, as its source. */
  shaders(): readonly string[]
}

const SHAPES = 'shape instances'

interface StubBuffer {
  label: string
  destroy: () => void
}

export function createStubDevice(): StubDevice {
  // Browser globals the builders reference at runtime. Node has no such thing, and the
  // WebGPU types describe them as interfaces rather than plain records, so the cast goes
  // through unknown.
  const global = globalThis as unknown as {
    GPUBufferUsage?: Record<string, number>
    GPUShaderStage?: Record<string, number>
    GPUTextureUsage?: Record<string, number>
  }
  global.GPUBufferUsage ??= { VERTEX: 0x20, COPY_DST: 0x08, UNIFORM: 0x40, STORAGE: 0x80 }
  global.GPUShaderStage ??= { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 }
  global.GPUTextureUsage ??= { COPY_DST: 0x02, TEXTURE_BINDING: 0x04, RENDER_ATTACHMENT: 0x10 }

  const uploads = new Map<string, Float32Array>()
  const empty = new Float32Array(0)
  const textures: GPUTextureDescriptor[] = []
  const pipelines: GPURenderPipelineDescriptor[] = []
  const shaders: string[] = []

  const device = {
    createBuffer: ({ label }: { label?: string }): StubBuffer => ({
      label: label ?? '',
      destroy: () => {},
    }),
    createBindGroupLayout: () => ({}),
    createBindGroup: () => ({}),
    // The atlas is the only texture in the app, and the two things about it that fail
    // quietly are its format and its usage flags, so the descriptor is what gets kept.
    createTexture: (descriptor: GPUTextureDescriptor) => {
      textures.push(descriptor)
      return { createView: () => ({}), destroy: () => {} }
    },
    createSampler: () => ({}),
    createShaderModule: ({ code }: GPUShaderModuleDescriptor) => {
      shaders.push(code)
      return {}
    },
    createPipelineLayout: () => ({}),
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      pipelines.push(descriptor)
      return {}
    },
    queue: {
      writeBuffer: (buffer: StubBuffer, _offset: number, data: ArrayBuffer) => {
        uploads.set(buffer.label, new Float32Array(data))
      },
      copyExternalImageToTexture: () => {},
    },
    // The real thing has dozens of members this never touches, so it is cast rather than
    // implemented. Narrowing that cast would mean stubbing the whole WebGPU surface.
  } as unknown as GPUDevice

  return {
    device,
    written: (label = SHAPES) => uploads.get(label) ?? empty,
    textures: () => textures,
    pipelines: () => pipelines,
    shaders: () => shaders,
  }
}

/** Reads field `slot` of instance `index`, given a stride in floats. */
export function instanceAt(data: Float32Array, stride: number, index: number, slot: number): number {
  return data[index * stride + slot] ?? Number.NaN
}
