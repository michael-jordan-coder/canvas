import { describe, expect, it } from 'vitest'
import { formatAnswer } from './protocol.ts'

describe('formatAnswer', () => {
  it('reads a single choice back as itself', () => {
    expect(formatAnswer({ selected: ['Playful'] })).toBe('Playful')
  })

  it('joins a multi-select in the order it was chosen', () => {
    expect(formatAnswer({ selected: ['Modern', 'Corporate'] })).toBe('Modern, Corporate')
  })

  it('puts the free-text answer after the picked options, trimmed', () => {
    expect(formatAnswer({ selected: ['Modern'], other: '  something warmer ' })).toBe(
      'Modern, something warmer',
    )
  })

  it('is just the free text when nothing was picked', () => {
    expect(formatAnswer({ selected: [], other: 'a dark theme' })).toBe('a dark theme')
  })

  it('ignores a blank free-text field rather than trailing a comma', () => {
    expect(formatAnswer({ selected: ['Modern'], other: '   ' })).toBe('Modern')
  })
})
