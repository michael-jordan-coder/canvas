/**
 * A fake GPUDevice, enough to test the instance builders without a GPU.
 *
 * They only ever call `createBuffer` and `queue.writeBuffer`, so capturing the second gives
 * the exact bytes the GPU would have received. This is what makes packing bugs catchable:
 * a wrong offset or a missing field shows up as a number in the wrong slot rather than as a
 * shape drawn in the wrong place.
 */
export interface StubDevice {
  device: GPUDevice
  /** The most recent upload, as floats. */
  written(): Float32Array
}

export function createStubDevice(): StubDevice {
  // A browser global the builders reference at runtime. Node has no such thing.
  const global = globalThis as { GPUBufferUsage?: { VERTEX: number; COPY_DST: number } }
  global.GPUBufferUsage ??= { VERTEX: 0x20, COPY_DST: 0x08 }

  let captured = new Float32Array(0)

  const device = {
    createBuffer: () => ({ destroy: () => {} }),
    queue: {
      writeBuffer: (_buffer: unknown, _offset: number, data: ArrayBuffer) => {
        captured = new Float32Array(data)
      },
    },
    // The real thing has dozens of members this never touches, so it is cast rather than
    // implemented. Narrowing that cast would mean stubbing the whole WebGPU surface.
  } as unknown as GPUDevice

  return { device, written: () => captured }
}

/** Reads field `slot` of instance `index`, given a stride in floats. */
export function instanceAt(data: Float32Array, stride: number, index: number, slot: number): number {
  return data[index * stride + slot] ?? Number.NaN
}
