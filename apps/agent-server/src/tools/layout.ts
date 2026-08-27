import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { layoutFields, nodeId } from './schemas.ts'
import { run, type CanvasTool, type Forward } from './runner.ts'

/** Auto layout: turning it on, changing it, how a child behaves inside it, and wrapping. */
export function layoutTools(forward: Forward): CanvasTool[] {
  return [
    tool(
      'set_auto_layout',
      'Enable auto layout on a frame or change its settings. Enabling infers direction, gap and padding from where the children already sit, then your fields override. Children then flow in a row or column and manual positions stop applying.',
      { frameId: nodeId, ...layoutFields },
      run(forward, 'set_auto_layout'),
    ),
    tool(
      'remove_auto_layout',
      'Switch auto layout off. Children keep the positions the layout gave them.',
      { frameId: nodeId },
      run(forward, 'remove_auto_layout'),
    ),
    tool(
      'set_layout_child',
      'How a node behaves inside an auto layout parent: fixed keeps its own size, fill stretches to the frame.',
      {
        nodeId,
        widthMode: z.enum(['fixed', 'fill']).optional(),
        heightMode: z.enum(['fixed', 'fill']).optional(),
      },
      run(forward, 'set_layout_child'),
    ),
    tool(
      'wrap_in_auto_layout',
      'Wrap nodes in a new auto layout frame drawn 10 around their bounds, hugging on both axes. Nothing moves; returns the new frame id.',
      { nodeIds: z.array(nodeId).min(1).max(200) },
      run(forward, 'wrap_in_auto_layout'),
    ),
  ]
}
