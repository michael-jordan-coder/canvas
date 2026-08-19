import source from '../shaders/shape.wgsl?raw'

const BYTES_PER_INSTANCE = 80

/**
 * One pipeline for every shape in the document, and for every glyph of every text node.
 *
 * The vertex buffer steps per instance rather than per vertex, so the four quad corners are
 * shared by every shape and only the 80 bytes describing each one are read separately.
 *
 * Text is not a pipeline of its own. A glyph is one more instance in the same buffer, whose
 * spare slots carry a rectangle of the atlas instead of a corner radius and a stroke. That
 * keeps the whole document in one draw call, and more importantly keeps glyphs in painter's
 * order among the shapes: a rectangle drawn over a word covers it, which a separate text
 * pass could not manage without splitting the shape draw around every text node.
 */
export function createShapePipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraLayout: GPUBindGroupLayout,
  clipLayout: GPUBindGroupLayout,
  atlasLayout: GPUBindGroupLayout,
): GPURenderPipeline {
  const module = device.createShaderModule({ label: 'shape', code: source })

  return device.createRenderPipeline({
    label: 'shape',
    // The clip table is a second group rather than a second binding in the first, so the
    // overlay pipeline can keep sharing the matrix layout without knowing clips exist. The
    // glyph atlas follows the same rule as a third.
    layout: device.createPipelineLayout({
      bindGroupLayouts: [cameraLayout, clipLayout, atlasLayout],
    }),
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
            { shaderLocation: 4, offset: 64, format: 'float32x4' },
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
