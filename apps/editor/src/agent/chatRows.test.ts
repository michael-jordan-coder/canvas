import { describe, expect, it } from 'vitest'
import type { ChatItem } from './agentStore'
import { failureCount, isNearBottom, stepsLabel, toRows } from './chatRows'

let id = 0
function item(kind: ChatItem['kind'], text = ''): ChatItem {
  id += 1
  return { id, kind, text }
}

describe('toRows', () => {
  it('folds a consecutive run of process items into one row', () => {
    const rows = toRows([
      item('user', 'make a card'),
      item('thinking', 'planning'),
      item('tool', 'create_frame'),
      item('tool', 'create_text'),
      item('assistant', 'Done.'),
    ])
    expect(rows.map((row) => row.kind)).toEqual(['item', 'steps', 'item'])
    expect(rows[1]?.kind === 'steps' && rows[1].items).toHaveLength(3)
  })

  it('breaks a run when the conversation resumes', () => {
    const rows = toRows([
      item('tool', 'create_frame'),
      item('assistant', 'One moment.'),
      item('tool', 'set_fill'),
    ])
    expect(rows.map((row) => row.kind)).toEqual(['steps', 'item', 'steps'])
  })

  it('folds a failed step in with the run it belongs to', () => {
    const rows = toRows([item('tool', 'set_fill'), item('tool-error', 'set fill failed: no node')])
    expect(rows).toHaveLength(1)
    const only = rows[0]
    expect(only?.kind === 'steps' && failureCount(only.items) > 0).toBe(true)
  })

  it('leaves a run of clean steps reporting no failure', () => {
    expect(failureCount([item('tool'), item('thinking')])).toBe(0)
    expect(failureCount([item('tool'), item('thinking')])).toBe(0)
  })

  it('counts the failures rather than only noticing one', () => {
    expect(failureCount([item('tool-error'), item('tool'), item('tool-error')])).toBe(2)
  })

  it('gives every row a key that survives the list growing', () => {
    const first = item('tool', 'create_frame')
    const before = toRows([first])
    const after = toRows([first, item('tool', 'create_text')])
    // The run is keyed by the item that opened it, so appending to it is not a remount.
    expect(after[0]?.key).toBe(before[0]?.key)
  })
})

describe('isNearBottom', () => {
  it('is true at the end and just short of it', () => {
    expect(isNearBottom(600, 1000, 400)).toBe(true)
    expect(isNearBottom(580, 1000, 400)).toBe(true)
  })

  it('is false once the transcript has been scrolled back', () => {
    expect(isNearBottom(200, 1000, 400)).toBe(false)
  })

  it('is true when there is nothing to scroll', () => {
    expect(isNearBottom(0, 300, 400)).toBe(true)
  })
})

describe('stepsLabel', () => {
  it('names the step in progress while the run is growing', () => {
    expect(stepsLabel([item('tool', 'Create frame Header')], true)).toBe('Create frame Header')
  })

  it('says only that it is thinking, which has no object to name', () => {
    expect(stepsLabel([item('thinking', 'at length')], true)).toBe('Thinking')
  })

  it('counts the steps once the run has settled, singular at one', () => {
    expect(stepsLabel([item('tool'), item('tool')], false)).toBe('2 steps')
    expect(stepsLabel([item('tool')], false)).toBe('1 step')
  })

  it('says how many failed, which is the reason to open a settled run', () => {
    expect(stepsLabel([item('tool'), item('tool-error'), item('tool-error')], false)).toBe(
      '3 steps, 2 failed',
    )
  })
})
