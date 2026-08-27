import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { nodeId, paints, shapeArgs } from './schemas.ts'
import { run, type CanvasTool, type Forward } from './runner.ts'

/**
 * Text, both halves. Creating and updating sit together because they are about the same two
 * rules: the box sizes itself to its words until given a width, and the height is always
 * measured rather than set.
 */
export function textTools(forward: Forward): CanvasTool[] {
  return [
    tool(
      'create_text',
      'Create a text node. Without width the box sizes itself to its words; with width the text wraps to it and only the height is measured.',
      {
        parentId: shapeArgs.parentId,
        x: shapeArgs.x,
        y: shapeArgs.y,
        characters: z.string().describe('The text content'),
        fontSize: z.number().positive().optional().describe('Default 16'),
        width: z.number().positive().optional().describe('Fixed wrap width'),
        name: shapeArgs.name,
        fills: paints.optional(),
      },
      run(forward, 'create_text'),
    ),
    tool(
      'update_text',
      'Change a text node: its characters, font size, or autoWidth (true returns the box to sizing itself).',
      {
        nodeId,
        characters: z.string().optional(),
        fontSize: z.number().positive().optional(),
        autoWidth: z.boolean().optional(),
      },
      run(forward, 'update_text'),
    ),
  ]
}
