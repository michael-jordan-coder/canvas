import { describe, expect, it } from 'vitest'
import type { NodeId } from '@canvas/document'
import { mergeMarqueeSelection, selectionChanged } from './marquee'

const ids = (...names: string[]): NodeId[] => names.map((name) => name as NodeId)

describe('mergeMarqueeSelection', () => {
  it('keeps the base first, in its own order', () => {
    expect(mergeMarqueeSelection(ids('a', 'b'), ids('c', 'd'))).toEqual(ids('a', 'b', 'c', 'd'))
  })

  it('does not repeat a caught node already in the base', () => {
    expect(mergeMarqueeSelection(ids('a', 'b'), ids('b', 'c'))).toEqual(ids('a', 'b', 'c'))
  })

  it('is just the caught nodes over an empty base', () => {
    expect(mergeMarqueeSelection([], ids('a', 'b'))).toEqual(ids('a', 'b'))
  })
})

describe('selectionChanged', () => {
  it('is false for identical lists', () => {
    expect(selectionChanged(ids('a', 'b'), ids('a', 'b'))).toBe(false)
    expect(selectionChanged([], [])).toBe(false)
  })

  it('is true when a node was added or removed', () => {
    expect(selectionChanged(ids('a', 'b', 'c'), ids('a', 'b'))).toBe(true)
    expect(selectionChanged(ids('a'), ids('a', 'b'))).toBe(true)
  })

  it('is true when the order differs, because order is paint order', () => {
    expect(selectionChanged(ids('b', 'a'), ids('a', 'b'))).toBe(true)
  })
})
