import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { CommandName } from './protocol.ts'

/**
 * The agent's hands. Every tool forwards its arguments to the editor over the bridge and
 * returns whatever the editor's executor answered, so this file decides what the model may
 * ask for and `executor.ts` in the editor decides what actually happens to the document.
 *
 * One tool per editor command, which was a deliberate choice over a generic apply-patch
 * tool: a narrow schema per operation means the model cannot produce a half-valid document
 * state, and a bad call fails with a message naming the field instead of a parse error.
 *
 * The schemas mirror the arg types in `protocol.ts` by hand; see the note there.
 */

export type Forward = (name: CommandName, args: unknown) => Promise<unknown>

type ToolResult = {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >
  isError?: boolean
}

const hex = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'a 6 digit hex color like #1a1a1a')
  .describe('Hex color, e.g. "#0a7cff"')

const paint = z.object({
  hex,
  opacity: z.number().min(0).max(1).optional().describe('Paint opacity, 0 to 1. Default 1.'),
})

const paints = z
  .array(paint)
  .max(8)
  .describe('Paint stack, topmost first, the way a layers panel lists them.')

const stroke = z.object({
  hex,
  weight: z.number().positive().describe('Stroke thickness in canvas units'),
  align: z.enum(['inside', 'outside', 'center']).describe('Where the band sits on the edge'),
  opacity: z.number().min(0).max(1).optional(),
})

const nodeId = z.string().describe('A node id from get_document, e.g. "n12"')

const cornerRadii = z.object({
  topLeft: z.number().min(0),
  topRight: z.number().min(0),
  bottomRight: z.number().min(0),
  bottomLeft: z.number().min(0),
})

const shapeArgs = {
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

const layoutFields = {
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

/**
 * Wraps a forward into the shape the SDK wants back, stringifying the editor's answer.
 * Errors come back as `isError` with the message intact, because the message is written for
 * the model: "No node n7" is actionable, a thrown stack trace is not.
 */
function run(forward: Forward, name: CommandName) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const value = await forward(name, args)
      return { content: [{ type: 'text', text: JSON.stringify(value) }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }
}

/** The MCP server the query mounts, holding every canvas tool. */
export function createCanvasMcpServer(forward: Forward): ReturnType<typeof createSdkMcpServer> {
  const tools = [
    tool(
      'get_document',
      'Read the whole document as a tree: every node with its id, type, name, position, size, paints and layout, plus the current selection. Call this before editing anything you did not just create.',
      {},
      run(forward, 'get_document'),
    ),
    tool(
      'get_node',
      'Read one node and its subtree by id.',
      { nodeId },
      run(forward, 'get_node'),
    ),
    tool(
      'screenshot',
      'See the canvas as an image. fit "all" frames everything in the document, "selection" frames the current selection, a nodeId frames that node, "view" captures whatever is on screen. Use this to judge your work visually after a batch of edits.',
      {
        fit: z.enum(['view', 'all', 'selection']).optional(),
        nodeId: nodeId.optional().describe('Frame this node instead of using fit'),
      },
      async (args): Promise<ToolResult> => {
        try {
          const value = (await forward('screenshot', args)) as {
            mimeType: string
            base64: string
          }
          return {
            content: [{ type: 'image', data: value.base64, mimeType: value.mimeType }],
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { content: [{ type: 'text', text: message }], isError: true }
        }
      },
    ),
    tool(
      'set_selection',
      'Select nodes in the editor. The selection outline is visible to the user, so this is also how you point at things while explaining.',
      { nodeIds: z.array(nodeId).max(200) },
      run(forward, 'set_selection'),
    ),
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
      { nodeId, parentId: nodeId.describe('The new parent frame, or the page id'), index: z.number().int().min(0).optional() },
      run(forward, 'reparent_node'),
    ),
    tool(
      'reorder_node',
      'Change paint order among siblings: forward/backward one step, front/back all the way. In an auto layout frame this is also the flow order.',
      { nodeId, command: z.enum(['forward', 'backward', 'front', 'back']) },
      run(forward, 'reorder_node'),
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

  return createSdkMcpServer({ name: 'canvas', version: '1.0.0', tools })
}
