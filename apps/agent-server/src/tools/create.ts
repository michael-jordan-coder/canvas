import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { shapeArgs } from './schemas.ts'
import { run, type CanvasTool, type Forward } from './runner.ts'

/** Making shapes. Text is created in `text.ts`, beside the tool that edits it. */
export function createTools(forward: Forward): CanvasTool[] {
  return [
    tool(
      'create_frame',
      'Create a frame, the container other nodes live in. Frames clip their children by default and are what auto layout applies to.',
      { ...shapeArgs, clipsContent: z.boolean().optional().describe('Default true') },
      run(forward, 'create_frame'),
    ),
    tool('create_rectangle', 'Create a rectangle.', shapeArgs, run(forward, 'create_rectangle')),
    tool(
      'create_ellipse',
      'Create an ellipse. Width and height are the bounding box; equal values make a circle.',
      shapeArgs,
      run(forward, 'create_ellipse'),
    ),
  ]
}
