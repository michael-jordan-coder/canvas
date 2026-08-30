import { describe, expect, it } from 'vitest'
import { InvalidCodeTreeError, MAX_ELEMENTS, validateCodeTree } from './validate.js'

function frame(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'frame', id, props: {}, ...extra }
}

describe('validateCodeTree', () => {
  it('accepts a tree using every prop family', () => {
    const roots = validateCodeTree([
      {
        type: 'frame',
        id: 'root',
        name: 'Card',
        props: {
          x: 10,
          y: 20,
          width: 200,
          background: '#ffffff',
          borderColor: '#111111',
          borderWidth: 1,
          borderRadius: 8,
          opacity: 0.9,
          overflow: 'hidden',
          direction: 'column',
          gap: 8,
          padding: { top: 12, right: 16, bottom: 12, left: 16 },
          align: 'center',
          justify: 'space-between',
        },
        events: { click: true },
        children: [
          {
            type: 'text',
            id: 'root/label',
            key: 'label',
            props: { fontSize: 14, color: '#333333', grow: true },
            text: 'Hello',
          },
        ],
      },
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0]?.children?.[0]?.text).toBe('Hello')
  })

  it('is not fooled by a non-array', () => {
    expect(() => validateCodeTree({ type: 'frame' })).toThrow(InvalidCodeTreeError)
  })

  it('names the path of a bad number', () => {
    expect(() =>
      validateCodeTree([frame('a', { children: [{ type: 'frame', id: 'a/b', props: { gap: 'wide' } }] })]),
    ).toThrow(/tree\[0\]\.children\[0\]\.props\.gap is not a finite number/)
  })

  it('refuses a prop it does not know rather than carrying it', () => {
    expect(() => validateCodeTree([frame('a', { props: { zIndex: 3 } })])).toThrow(
      /props\.zIndex is not a prop this canvas knows/,
    )
  })

  it('refuses a color that is not six hex digits', () => {
    expect(() => validateCodeTree([frame('a', { props: { background: 'red' } })])).toThrow(
      /is not a hex color/,
    )
  })

  it('keeps text content on text elements only', () => {
    expect(() => validateCodeTree([frame('a', { text: 'nope' })])).toThrow(
      /text is only valid on a text element/,
    )
  })

  it('keeps children on frames only', () => {
    expect(() =>
      validateCodeTree([{ type: 'rectangle', id: 'a', props: {}, children: [] }]),
    ).toThrow(/children is only valid on a frame/)
  })

  it('rejects duplicate sibling ids, which would collapse into one node', () => {
    expect(() => validateCodeTree([frame('a'), frame('a')])).toThrow(/keys must be unique/)
  })

  it('stops a runaway element count at the budget, not the heap', () => {
    const children = Array.from({ length: MAX_ELEMENTS + 1 }, (_unused, index) => ({
      type: 'rectangle',
      id: `a/${index}`,
      props: {},
    }))
    expect(() => validateCodeTree([frame('a', { children })])).toThrow(/more than/)
  })

  it('stops at the depth cap', () => {
    let leaf: Record<string, unknown> = frame('deep')
    for (let level = 0; level < 40; level += 1) leaf = frame(`level${level}`, { children: [leaf] })
    expect(() => validateCodeTree([leaf])).toThrow(/nested deeper/)
  })

  it('rejects an event kind it does not know', () => {
    expect(() => validateCodeTree([frame('a', { events: { keydown: true } })])).toThrow(
      /keydown is not an event/,
    )
  })
})
