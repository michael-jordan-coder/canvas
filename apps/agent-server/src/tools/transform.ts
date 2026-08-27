import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { nodeId } from './schemas.ts'
import { run, type CanvasTool, type Forward } from './runner.ts'

/** Where a node is: its position, its size, its angle, and those of a group together. */
export function transformTools(forward: Forward): CanvasTool[] {
  return [
    tool(
      'move_node',
      "Set a node's origin in its parent's space. Inside an auto layout frame the layout owns positions, so use reorder_node there instead.",
      { nodeId, x: z.number(), y: z.number() },
      run(forward, 'move_node'),
    ),
    tool(
      'resize_node',
      'Set width and/or height. On a text node width sets the wrap width and height is measured, so passing height alone does nothing. On a hug axis of an auto layout frame this switches that axis to fixed.',
      {
        nodeId,
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      },
      run(forward, 'resize_node'),
    ),
    tool(
      'rotate_node',
      'Turn a node to an absolute angle in degrees, clockwise, about its own centre.',
      { nodeId, degrees: z.number() },
      run(forward, 'rotate_node'),
    ),
    tool(
      'align_nodes',
      'Align or distribute nodes. One node aligns within its parent frame; several align to their combined bounds. Distribution needs three or more.',
      {
        nodeIds: z.array(nodeId).min(1).max(200),
        command: z.enum([
          'left',
          'centerX',
          'right',
          'top',
          'centerY',
          'bottom',
          'distributeHorizontal',
          'distributeVertical',
        ]),
      },
      run(forward, 'align_nodes'),
    ),
    tool(
      'flip_nodes',
      'Mirror nodes across the centre of their combined bounds. horizontal mirrors left-right.',
      { nodeIds: z.array(nodeId).min(1).max(200), axis: z.enum(['horizontal', 'vertical']) },
      run(forward, 'flip_nodes'),
    ),
  ]
}
