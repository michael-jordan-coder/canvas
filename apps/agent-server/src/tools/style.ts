import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { cornerRadii, nodeId, paints, stroke } from './schemas.ts'
import { run, type CanvasTool, type Forward } from './runner.ts'

/** How a node looks: its paints, its corners, its opacity and whether it is drawn at all. */
export function styleTools(forward: Forward): CanvasTool[] {
  return [
    tool(
      'set_fills',
      "Replace a node's fill stack. Pass the full stack, topmost first; an empty array removes every fill.",
      { nodeId, fills: paints },
      run(forward, 'set_fills'),
    ),
    tool(
      'set_strokes',
      "Replace a node's stroke stack. Pass the full stack, topmost first; an empty array removes every stroke.",
      { nodeId, strokes: z.array(stroke).max(8) },
      run(forward, 'set_strokes'),
    ),
    tool(
      'set_corner_radii',
      'Round the corners of a frame or rectangle. Pass radius for all four or radii per corner.',
      { nodeId, radius: z.number().min(0).optional(), radii: cornerRadii.optional() },
      run(forward, 'set_corner_radii'),
    ),
    tool(
      'set_opacity',
      "Set a node's opacity, 0 to 1. Multiplies with the opacity of its paints.",
      { nodeId, opacity: z.number().min(0).max(1) },
      run(forward, 'set_opacity'),
    ),
    tool(
      'set_visible',
      'Show or hide a node. A hidden child of an auto layout frame leaves the flow.',
      { nodeId, visible: z.boolean() },
      run(forward, 'set_visible'),
    ),
  ]
}
