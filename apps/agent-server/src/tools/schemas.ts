import { z } from 'zod'

/**
 * The vocabulary every tool schema is built from. Shared here rather than restated per tool,
 * so that two tools taking a paint stack cannot come to disagree about what one is.
 *
 * These mirror the arg types in `protocol.ts` by hand; see the note there.
 */

export const hex = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'a 6 digit hex color like #1a1a1a')
  .describe('Hex color, e.g. "#0a7cff"')

export const paint = z.object({
  hex,
  opacity: z.number().min(0).max(1).optional().describe('Paint opacity, 0 to 1. Default 1.'),
})

export const paints = z
  .array(paint)
  .max(8)
  .describe('Paint stack, topmost first, the way a layers panel lists them.')

export const stroke = z.object({
  hex,
  weight: z.number().positive().describe('Stroke thickness in canvas units'),
  align: z.enum(['inside', 'outside', 'center']).describe('Where the band sits on the edge'),
  opacity: z.number().min(0).max(1).optional(),
})

export const nodeId = z.string().describe('A node id from get_document, e.g. "n12"')

export const cornerRadii = z.object({
  topLeft: z.number().min(0),
  topRight: z.number().min(0),
  bottomRight: z.number().min(0),
  bottomLeft: z.number().min(0),
})

export const shapeArgs = {
  parentId: nodeId
    .optional()
    .describe('Frame to create inside. Omit to create at the top level of the page.'),
  x: z.number().describe("Origin x in the parent's space, y grows downward"),
  y: z.number().describe("Origin y in the parent's space"),
  width: z.number().positive(),
  height: z.number().positive(),
  name: z.string().optional().describe('Layer name shown in the panel'),
  fills: paints.optional(),
  strokes: z.array(stroke).max(8).optional(),
  cornerRadius: z.number().min(0).optional().describe('Same radius on all four corners'),
}

export const layoutFields = {
  direction: z.enum(['horizontal', 'vertical']).optional(),
  gap: z.number().min(0).optional().describe('Space between children along the direction'),
  padding: z
    .object({
      top: z.number().min(0),
      right: z.number().min(0),
      bottom: z.number().min(0),
      left: z.number().min(0),
    })
    .optional(),
  mainAlign: z.enum(['start', 'center', 'end', 'space-between']).optional(),
  crossAlign: z.enum(['start', 'center', 'end']).optional(),
  mainSizing: z
    .enum(['fixed', 'hug'])
    .optional()
    .describe('hug means the frame sizes itself to its children on that axis'),
  crossSizing: z.enum(['fixed', 'hug']).optional(),
}
