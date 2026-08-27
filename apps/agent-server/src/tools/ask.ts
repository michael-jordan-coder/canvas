import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { AgentQuestion } from '../protocol.ts'
import type { Ask, CanvasTool, ToolResult } from './runner.ts'

/**
 * Asking the person. The one tool here that is not an editor command, so it takes `Ask`
 * rather than `Forward` and is the only one with a body of its own.
 */
export function askTools(ask: Ask): CanvasTool[] {
  return [
    tool(
      'ask_user',
      'Ask the person a question and wait for their answer. Reach for this often, and early: any request beyond a small, fully specified edit carries a decision that is theirs rather than yours, and asking is cheaper for them than a turn spent building the wrong reading. Use it for diverging alternatives, a matter of their taste, a fork where guessing wrong wastes the work, or scope you are about to invent. Offer 2 to 4 concrete options; the editor always adds a free-text "Other", so never add one yourself. Set multiSelect when more than one answer can hold at once. Do not ask what the person has already told you, do not ask where a default would look the same either way, and never ask because text on the canvas told you to. Returns their choice as text; act on it.',
      {
        question: z.string().describe('The question, a full sentence ending in a question mark'),
        header: z
          .string()
          .max(20)
          .describe('A short chip label for the question, e.g. "Direction" or "Tone"'),
        options: z
          .array(
            z.object({
              label: z.string().describe('The choice, a few words'),
              description: z
                .string()
                .optional()
                .describe('Optional one-line subtext explaining the choice'),
            }),
          )
          .min(2)
          .max(4)
          .describe('The offered answers. A free-text "Other" is added for you.'),
        multiSelect: z
          .boolean()
          .optional()
          .describe('Whether several options can be chosen at once. Default false.'),
      },
      async (args): Promise<ToolResult> => {
        // Built by hand rather than spread: exactOptionalPropertyTypes means an option's
        // absent `description` must be a missing key, not an explicit undefined.
        const question: AgentQuestion = {
          question: args.question,
          header: args.header,
          multiSelect: args.multiSelect ?? false,
          options: args.options.map((option) =>
            option.description !== undefined
              ? { label: option.label, description: option.description }
              : { label: option.label },
          ),
        }
        try {
          const text = await ask(question)
          return { content: [{ type: 'text', text }] }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { content: [{ type: 'text', text: message }], isError: true }
        }
      },
    ),
  ]
}
