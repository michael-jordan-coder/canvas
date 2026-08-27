import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { nodeId } from './schemas.ts'
import { run, type CanvasTool, type Forward } from './runner.ts'

/** Reading the document, and pointing at part of it. */
export function readTools(forward: Forward): CanvasTool[] {
  return [
    tool(
      'get_document',
      'Read the whole document as a tree: every node with its id, type, name, position, size, paints and layout, plus the current selection. Call this before editing anything you did not just create.',
      {},
      run(forward, 'get_document'),
    ),
    tool('get_node', 'Read one node and its subtree by id.', { nodeId }, run(forward, 'get_node')),
    tool(
      'set_selection',
      'Select nodes in the editor. The selection outline is visible to the user, so this is also how you point at things while explaining.',
      { nodeIds: z.array(nodeId).max(200) },
      run(forward, 'set_selection'),
    ),
  ]
}
