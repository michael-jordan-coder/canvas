/*
 * The one description of what a shape instance is, held here rather than in either of the
 * two files that need it.
 *
 * `ShapeInstances` writes the bytes and `pipelines/shape.ts` declares how to read them, and
 * a disagreement between the two is not a compile error: it is every shape on screen reading
 * the wrong slots. They used to restate the stride independently, which is exactly the kind
 * of duplication that survives review and then fails silently.
 */

/**
 * linear (4) + origin and size (4) + colour (4) + params (4) + flags (4) + corner radii (4).
 *
 * 96 bytes, which is 6 x 16, so every attribute lands naturally aligned and none of them
 * needs padding to reach its offset.
 */
export const FLOATS_PER_INSTANCE = 24

export const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4

/**
 * Where each slot of the packing starts. Adding a slot there means adding a location here.
 *
 * Six attributes against a `maxVertexAttributes` of 16, and a stride of 96 against a
 * `maxVertexBufferArrayStride` of 2048, so there is room left in both budgets.
 */
export const SHAPE_ATTRIBUTES: readonly GPUVertexAttribute[] = [
  { shaderLocation: 0, offset: 0, format: 'float32x4' },
  { shaderLocation: 1, offset: 16, format: 'float32x4' },
  { shaderLocation: 2, offset: 32, format: 'float32x4' },
  { shaderLocation: 3, offset: 48, format: 'float32x4' },
  { shaderLocation: 4, offset: 64, format: 'float32x4' },
  { shaderLocation: 5, offset: 80, format: 'float32x4' },
]

/**
 * The feature bitfield at float 19 (`flags.w`), carried as a small exact float and read as
 * a u32 by the shader. A solid, unshadowed instance is 0, which is what every instance
 * wrote before either feature existed.
 */
export const BIT_GRADIENT = 1
export const BIT_SHADOW = 2
