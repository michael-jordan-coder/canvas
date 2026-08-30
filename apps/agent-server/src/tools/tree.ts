import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { nodeId } from './schemas.ts'
import { run, type CanvasTool, type Forward } from './runner.ts'

/** The tree itself: what a node is called, whether it exists, and where it sits in the stack. */
export function treeTools(forward: Forward): CanvasTool[] {
  return [
    tool('rename_node', 'Rename a layer.', { nodeId, name: z.string() }, run(forward, 'rename_node')),
    tool(
      'delete_nodes',
      'Delete nodes and their subtrees.',
      { nodeIds: z.array(nodeId).min(1).max(200) },
      run(forward, 'delete_nodes'),
    ),
    tool(
      'duplicate_nodes',
      'Copy nodes next to themselves, offset by dx/dy, and return the new ids.',
      {
        nodeIds: z.array(nodeId).min(1).max(200),
        dx: z.number().optional().describe('Default 10'),
        dy: z.number().optional().describe('Default 10'),
      },
      run(forward, 'duplicate_nodes'),
    ),
    tool(
      'reparent_node',
      'Move a node into a different frame (or the page), keeping it exactly where it appears. index 0 is the back of the paint stack.',
      {
        nodeId,
        parentId: nodeId.describe('The new parent frame, or the page id'),
        index: z.number().int().min(0).optional(),
      },
      run(forward, 'reparent_node'),
    ),
    tool(
      'reorder_node',
      'Change paint order among siblings: forward/backward one step, front/back all the way. In an auto layout frame this is also the flow order.',
      { nodeId, command: z.enum(['forward', 'backward', 'front', 'back']) },
      run(forward, 'reorder_node'),
    ),
  ]
}
