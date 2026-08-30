import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { CommandName } from '../protocol.ts'

/**
 * What every tool file is built from: the way out of this process, the result shape the SDK
 * wants back, and the wrapper that turns one into the other.
 */

export type Forward = (name: CommandName, args: unknown) => Promise<unknown>

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/**
 * One tool, as the server accepts it. Derived from `createSdkMcpServer`'s own parameter
 * rather than written out, because the SDK's tool type is generic over each tool's schema
 * and a hand written union would drift from what the server actually takes.
 */
export type CanvasTool = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>[number]

/**
 * Wraps a forward into the shape the SDK wants back, stringifying the editor's answer.
 * Errors come back as `isError` with the message intact, because the message is written for
 * the model: "No node n7" is actionable, a thrown stack trace is not.
 */
export function run(
  forward: Forward,
  name: CommandName,
): (args: Record<string, unknown>) => Promise<ToolResult> {
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
