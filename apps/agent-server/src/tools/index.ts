import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { askTools } from './ask.ts'
import { codeTools } from './code.ts'
import { createTools } from './create.ts'
import { layoutTools } from './layout.ts'
import { readTools } from './read.ts'
import { styleTools } from './style.ts'
import { textTools } from './text.ts'
import { transformTools } from './transform.ts'
import { treeTools } from './tree.ts'
import type { Ask, Forward } from './runner.ts'

/**
 * The agent's hands. Every tool forwards its arguments to the editor over the bridge and
 * returns whatever the editor's executor answered, so this directory decides what the model
 * may ask for and `executor.ts` in the editor decides what actually happens to the document.
 *
 * One tool per editor command, which was a deliberate choice over a generic apply-patch
 * tool: a narrow schema per operation means the model cannot produce a half-valid document
 * state, and a bad call fails with a message naming the field instead of a parse error.
 *
 * A file per domain rather than per tool: nearly every tool is a schema over
 * `run(forward, name)`, so a file each would be more import than tool, and tools that share
 * a schema are the ones worth reading side by side. `schemas.ts` holds that shared
 * vocabulary and `runner.ts` the forward wrapper; the rest is one group each.
 */

export type { Ask, Forward } from './runner.ts'

/** The MCP server the query mounts, holding every canvas tool. */
export function createCanvasMcpServer(
  forward: Forward,
  ask: Ask,
): ReturnType<typeof createSdkMcpServer> {
  const tools = [
    ...askTools(ask),
    ...readTools(forward),
    ...createTools(forward),
    ...textTools(forward),
    ...transformTools(forward),
    ...styleTools(forward),
    ...treeTools(forward),
    ...layoutTools(forward),
    ...codeTools(forward),
  ]

  return createSdkMcpServer({ name: 'canvas', version: '1.0.0', tools })
}
