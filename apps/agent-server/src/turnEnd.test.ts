import { describe, expect, it } from 'vitest'
import { resultReason, thrownReason } from './turnEnd.ts'

describe('resultReason', () => {
  it('names the turn cap as its own reason, since it is process rather than failure', () => {
    expect(resultReason('error_max_turns')).toEqual({ reason: 'max_turns' })
  })

  it('reports a failure without pretending to know which', () => {
    expect(resultReason('error_during_execution')).toEqual({ reason: 'error' })
  })

  it('keeps an unmapped subtype as the detail, since it is the only clue left', () => {
    expect(resultReason('error_something_new')).toEqual({
      reason: 'error',
      detail: 'error_something_new',
    })
  })
})

describe('thrownReason', () => {
  it('names the step cap when the SDK throws it rather than yielding it', () => {
    expect(
      thrownReason('Claude Code returned an error result: Reached maximum number of turns (50)'),
    ).toEqual({ reason: 'max_turns' })
  })

  it('keeps anything else as an error carrying its message', () => {
    expect(thrownReason('socket hang up')).toEqual({ reason: 'error', detail: 'socket hang up' })
  })
})
