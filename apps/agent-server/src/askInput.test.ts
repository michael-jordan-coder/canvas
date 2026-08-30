import { describe, expect, it } from 'vitest'
import { InvalidAskInputError, parseAskInput } from './askInput.ts'

const option = (label: string): Record<string, unknown> => ({ label, description: 'why' })

const question = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  question: 'Which direction?',
  header: 'Direction',
  multiSelect: false,
  options: [option('Modern'), option('Corporate')],
  ...over,
})

describe('parseAskInput', () => {
  it('reads a well formed call', () => {
    expect(parseAskInput({ questions: [question()] })).toEqual([
      {
        question: 'Which direction?',
        header: 'Direction',
        multiSelect: false,
        options: [
          { label: 'Modern', description: 'why' },
          { label: 'Corporate', description: 'why' },
        ],
      },
    ])
  })

  it('leaves an absent description off the option rather than setting it undefined', () => {
    const options = [{ label: 'A' }, { label: 'B' }]
    const parsed = parseAskInput({ questions: [question({ options })] })
    expect(Object.hasOwn(parsed[0]!.options[0]!, 'description')).toBe(false)
  })

  it('defaults multiSelect to false when it is missing', () => {
    const parsed = parseAskInput({ questions: [question({ multiSelect: undefined })] })
    expect(parsed[0]!.multiSelect).toBe(false)
  })

  it('ignores fields it does not know, so a newer SDK does not take the assistant down', () => {
    const parsed = parseAskInput({
      questions: [question({ options: [{ label: 'A', preview: '```ts```' }, option('B')] })],
    })
    expect(parsed[0]!.options[0]).toEqual({ label: 'A' })
  })

  it.each([
    ['input is not an object', null],
    ['questions is not an array', {}],
    ['questions is empty', { questions: [] }],
    [
      'questions holds 5 questions, more than 4',
      { questions: [1, 2, 3, 4, 5].map(() => question()) },
    ],
    ['questions[0] is not an object', { questions: ['ask me'] }],
    ['questions[0].question is not a string', { questions: [question({ question: 7 })] }],
    ['questions[0].question is empty', { questions: [question({ question: '  ' })] }],
    ['questions[0].header is not a string', { questions: [question({ header: null })] }],
    ['questions[0].options is not an array', { questions: [question({ options: 'a, b' })] }],
    [
      'questions[0].options holds 1 options, not 2 to 4',
      { questions: [question({ options: [option('A')] })] },
    ],
    [
      'questions[0].multiSelect is not a boolean',
      { questions: [question({ multiSelect: 'yes' })] },
    ],
    [
      'questions[0].options[1] is not an object',
      { questions: [question({ options: [option('A'), 'B'] })] },
    ],
    [
      'questions[0].options[0].label is not a string',
      { questions: [question({ options: [{}, option('B')] })] },
    ],
    [
      'questions[0].options[0].description is not a string',
      { questions: [question({ options: [{ label: 'A', description: 4 }, option('B')] })] },
    ],
  ])('names the path that failed: %s', (message, input) => {
    expect(() => parseAskInput(input)).toThrow(InvalidAskInputError)
    expect(() => parseAskInput(input)).toThrow(message)
  })
})
