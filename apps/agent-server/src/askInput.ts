import type { AgentQuestion, AgentQuestionOption } from './protocol.ts'

/**
 * The door for `AskUserQuestion`'s arguments.
 *
 * `ask_user` was our own tool, so its arguments arrived through a zod schema and were
 * checked before the body ever saw them. The built-in tool is the SDK's, and `canUseTool`
 * hands its input over as `Record<string, unknown>`: nothing between the model and this
 * function has looked at it. That makes it the third place untrusted input enters, after
 * `serialize.ts` and `code/validate.ts`, and it is held to their standard rather than to a
 * cast: hand written, every failure naming the path that failed.
 *
 * The caps are the built-in tool's own, restated here because a validator that trusts the
 * producer to have obeyed its own schema is not a validator. What is deliberately not
 * checked is `preview` and anything else the SDK may add: unknown keys are ignored rather
 * than refused, since a newer SDK adding a field must not take the assistant down.
 */
export class InvalidAskInputError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'InvalidAskInputError'
  }
}

const MAX_QUESTIONS = 4
const MIN_OPTIONS = 2
const MAX_OPTIONS = 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new InvalidAskInputError(`${path} is not a string`)
  if (value.trim() === '') throw new InvalidAskInputError(`${path} is empty`)
  return value
}

function parseOption(value: unknown, path: string): AgentQuestionOption {
  if (!isRecord(value)) throw new InvalidAskInputError(`${path} is not an object`)
  const label = requireString(value.label, `${path}.label`)
  // Absent rather than explicitly undefined, because `exactOptionalPropertyTypes` is on and
  // the two are not the same key. The built-in tool marks `description` required where ours
  // made it optional, so in practice this branch is the one that runs.
  if (value.description === undefined) return { label }
  return { label, description: requireString(value.description, `${path}.description`) }
}

function parseQuestion(value: unknown, path: string): AgentQuestion {
  if (!isRecord(value)) throw new InvalidAskInputError(`${path} is not an object`)
  const options = value.options
  if (!Array.isArray(options)) throw new InvalidAskInputError(`${path}.options is not an array`)
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw new InvalidAskInputError(
      `${path}.options holds ${options.length} options, not ${MIN_OPTIONS} to ${MAX_OPTIONS}`,
    )
  }
  if (value.multiSelect !== undefined && typeof value.multiSelect !== 'boolean') {
    throw new InvalidAskInputError(`${path}.multiSelect is not a boolean`)
  }
  return {
    question: requireString(value.question, `${path}.question`),
    header: requireString(value.header, `${path}.header`),
    multiSelect: value.multiSelect ?? false,
    options: options.map((option, i) => parseOption(option, `${path}.options[${i}]`)),
  }
}

/**
 * Reads the built-in tool's input into the questions the editor's card already speaks.
 * Throws `InvalidAskInputError` rather than returning null, because the one caller turns a
 * failure into a denial carrying the message, and the path is the whole value of it.
 */
export function parseAskInput(input: unknown): AgentQuestion[] {
  if (!isRecord(input)) throw new InvalidAskInputError('input is not an object')
  const questions = input.questions
  if (!Array.isArray(questions)) throw new InvalidAskInputError('questions is not an array')
  if (questions.length === 0) throw new InvalidAskInputError('questions is empty')
  if (questions.length > MAX_QUESTIONS) {
    throw new InvalidAskInputError(
      `questions holds ${questions.length} questions, more than ${MAX_QUESTIONS}`,
    )
  }
  return questions.map((question, i) => parseQuestion(question, `questions[${i}]`))
}
