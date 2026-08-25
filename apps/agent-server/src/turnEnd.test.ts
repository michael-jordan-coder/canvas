import { describe, expect, it } from 'vitest'
import { describeResult } from './turnEnd.ts'

describe('describeResult', () => {
  it('says what the turn cap is in words', () => {
    expect(describeResult('error_max_turns')).toBe(
      'The assistant reached its limit of steps for one turn.',
    )
  })

  it('says a failure happened without pretending to know which', () => {
    expect(describeResult('error_during_execution')).toBe(
      'The assistant hit an error partway through.',
    )
  })

  it('keeps an unmapped subtype, since it is the only clue left', () => {
    expect(describeResult('error_something_new')).toBe(
      'The assistant stopped before finishing (error_something_new).',
    )
  })
})
