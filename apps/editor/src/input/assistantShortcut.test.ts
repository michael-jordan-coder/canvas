import { describe, expect, it } from 'vitest'
import { isAssistantShortcut } from './assistantShortcut'

function press(
  key: string,
  modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  }
}

describe('isAssistantShortcut', () => {
  it('matches with either accelerator', () => {
    expect(isAssistantShortcut(press('k', { metaKey: true }))).toBe(true)
    expect(isAssistantShortcut(press('k', { ctrlKey: true }))).toBe(true)
  })

  it('matches whatever case the key arrives in', () => {
    expect(isAssistantShortcut(press('K', { metaKey: true }))).toBe(true)
  })

  it('needs the accelerator, so the bare key stays free for a tool', () => {
    expect(isAssistantShortcut(press('k'))).toBe(false)
  })

  it('does not match with alt or shift held, which are other bindings', () => {
    expect(isAssistantShortcut(press('k', { metaKey: true, altKey: true }))).toBe(false)
    expect(isAssistantShortcut(press('k', { metaKey: true, shiftKey: true }))).toBe(false)
  })

  it('does not match another key', () => {
    expect(isAssistantShortcut(press('j', { metaKey: true }))).toBe(false)
  })
})
