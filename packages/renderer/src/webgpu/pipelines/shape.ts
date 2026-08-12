import source from '../shaders/shape.wgsl?raw'

const BYTES_PER_INSTANCE = 64

/**
 * One pipeline for every shape in the document.
 *
 * The vertex buffer steps per instance rather than per vertex, so the four quad corners are
 * shared by every shape and only the 64 bytes describing each one are read separately.
 */
export function createShapePipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraLayout: GPUBindGroupLayout,
): GPURenderPipeline {
  const module = device.createShaderModule({ label: 'shape', code: source })

  return device.createRenderPipeline({
    label: 'shape',
    layout: device.createPipelineLayout({ bindGroupLayouts: [cameraLayout] }),
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
          // Straight alpha, since the fragment shader returns coverage in the alpha channel
          // rather than folding it into the colour. Without blending, antialiased edges
          // would write their partial alpha as opaque and every shape would have a hard
          // fringe.
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    // Four corners, no index buffer. Back to front order comes from the instance order in
    // the buffer, which is why there is no depth buffer: overlapping translucent shapes
    // need painter's order, and a depth test would throw their blending away.
    primitive: { topology: 'triangle-strip' },
  })
}
