import source from '../shaders/overlay.wgsl?raw'

const BYTES_PER_INSTANCE = 64

/**
 * The selection overlay pipeline. Identical in shape to the shape pipeline, but bound to a
 * pixels to clip matrix instead of a world to clip one, which is what makes its geometry
 * immune to the camera.
 */
export function createOverlayPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  screenLayout: GPUBindGroupLayout,
): GPURenderPipeline {
  const module = device.createShaderModule({ label: 'overlay', code: source })

  return device.createRenderPipeline({
    label: 'overlay',
    layout: device.createPipelineLayout({ bindGroupLayouts: [screenLayout] }),
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: BYTES_PER_INSTANCE,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
            { shaderLocation: 2, offset: 32, format: 'float32x4' },
            { shaderLocation: 3, offset: 48, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-strip' },
  })
}
