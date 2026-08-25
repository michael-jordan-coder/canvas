import { describe, expect, it } from 'vitest'
import { resultReason } from './turnEnd.ts'

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
