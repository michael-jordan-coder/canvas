import { describe, expect, it } from 'vitest'
import type { ChatItem } from './agentStore'
import { capItems, parseTranscript } from './chatStorage'

function item(id: number, kind: ChatItem['kind'] = 'user', text = 'hello'): ChatItem {
  return { id, kind, text }
}

function stored(items: unknown, version: unknown = 1): string {
  return JSON.stringify({ version, items })
}

describe('parseTranscript', () => {
  it('reads back what was written', () => {
    const items = [item(1, 'user', 'make a card'), item(2, 'assistant', 'Done.')]
    expect(parseTranscript(stored(items))).toEqual(items)
  })

  it('refuses a version it does not know rather than half reading it', () => {
    expect(parseTranscript(stored([item(1)], 2))).toEqual([])
  })

  it('returns nothing for anything that is not a transcript', () => {
    expect(parseTranscript('not json at all')).toEqual([])
    expect(parseTranscript('null')).toEqual([])
    expect(parseTranscript(stored('not an array'))).toEqual([])
  })

  it('drops an item it cannot read and keeps its neighbours', () => {
    const text = stored([
      item(1, 'user', 'first'),
      { id: 2, kind: 'from-a-newer-build', text: 'middle' },
      { id: 'three', kind: 'user', text: 'bad id' },
      { id: 4, kind: 'user' },
      item(5, 'assistant', 'last'),
    ])
    expect(parseTranscript(text).map((entry) => entry.text)).toEqual(['first', 'last'])
  })

  it('restores an answered question as a record, without its stale askId', () => {
    const question = {
      question: 'Row or column?',
      header: 'Direction',
      multiSelect: false,
      options: [{ label: 'Row', description: 'side by side' }, { label: 'Column' }],
    }
    const text = stored([
      {
        id: 1,
        kind: 'question',
        text: 'Row or column?',
        askId: 7,
        question,
        answer: { selected: ['Row'] },
      },
    ])
    expect(parseTranscript(text)).toEqual([
      { id: 1, kind: 'question', text: 'Row or column?', question, answer: { selected: ['Row'] } },
    ])
  })

  it('restores a question that was never answered, with no answer', () => {
    const question = { question: 'Tone?', header: 'Tone', multiSelect: true, options: [{ label: 'Warm' }, { label: 'Cool' }] }
    const text = stored([{ id: 1, kind: 'question', text: 'Tone?', question }])
    expect(parseTranscript(text)).toEqual([{ id: 1, kind: 'question', text: 'Tone?', question }])
  })

  it('drops a question whose payload is malformed rather than half rendering it', () => {
    const text = stored([
      item(1, 'user', 'first'),
      { id: 2, kind: 'question', text: 'broken', question: { header: 'x' } },
      { id: 3, kind: 'question', text: 'bad answer', question: { question: 'q', header: 'h', multiSelect: false, options: [{ label: 'a' }] }, answer: { selected: [5] } },
      item(4, 'assistant', 'last'),
    ])
    expect(parseTranscript(text).map((entry) => entry.text)).toEqual(['first', 'last'])
  })
})

describe('capItems', () => {
  it('keeps the newest by count', () => {
    const items = [item(1), item(2), item(3), item(4)]
    expect(capItems(items, 2).map((entry) => entry.id)).toEqual([3, 4])
  })

  it('keeps trimming from the front until it fits the byte budget', () => {
    const items = [item(1, 'thinking', 'x'.repeat(400)), item(2, 'user', 'short')]
    const kept = capItems(items, 100, 200)
    expect(kept.map((entry) => entry.id)).toEqual([2])
  })

  it('never trims to nothing, however large the last item is', () => {
    const items = [item(1, 'thinking', 'x'.repeat(5000))]
    expect(capItems(items, 100, 200)).toHaveLength(1)
  })

  it('passes a transcript that already fits through untouched', () => {
    const items = [item(1), item(2)]
    expect(capItems(items)).toEqual(items)
  })
})
