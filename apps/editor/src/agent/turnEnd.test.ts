import { describe, expect, it } from 'vitest'
import { turnEndItem } from './turnEnd'

describe('turnEndItem', () => {
  it('says nothing about a turn that simply finished', () => {
    expect(turnEndItem('ok')).toBeNull()
  })

  it('reads a stop as a state rather than as a failure', () => {
    expect(turnEndItem('stopped')).toEqual({ kind: 'notice', text: 'Stopped.' })
  })

  it('reads the step cap as process, which the conversation can carry on past', () => {
    expect(turnEndItem('max_turns')?.kind).toBe('notice')
  })

  it('reads a failure as one', () => {
    expect(turnEndItem('error')).toEqual({
      kind: 'error',
      text: 'The assistant hit an error partway through.',
    })
  })

  it('names the detail rather than showing it alone, since it is the only clue left', () => {
    expect(turnEndItem('error', 'error_something_new')?.text).toBe(
      'The assistant hit an error partway through (error_something_new).',
    )
  })
})
