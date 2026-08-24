import { describe, expect, it } from 'vitest'
import { SceneDocument } from '../document.js'
import { createCode } from '../node.js'
import type { CodeElement } from './element.js'
import { applyCodeTree, generatedBounds } from './instantiate.js'

function withCode() {
  const document = new SceneDocument()
  const code = document.insert(createCode({ source: 'irrelevant here' }))
  document.clearHistory()
  return { document, code }
}

function el(
  id: string,
  type: CodeElement['type'] = 'rectangle',
  extra: Partial<CodeElement> = {},
): CodeElement {
  return { type, id, props: {}, ...extra }
}

describe('applyCodeTree', () => {
  it('creates locked children carrying their source key', () => {
    const { document, code } = withCode()
    applyCodeTree(document, code.id, [
      el('a', 'rectangle', { props: { x: 10, y: 20, width: 100, height: 50, background: '#0a7cff' } }),
    ])
    const child = document.getChildren(code.id)[0]
    expect(child?.locked).toBe(true)
    expect(child?.sourceKey).toBe('a')
    expect(child?.transform.tx).toBe(10)
    expect(child?.size).toEqual({ width: 100, height: 50 })
  })

  it('keeps node ids stable where keys match across runs', () => {
    const { document, code } = withCode()
    applyCodeTree(document, code.id, [el('a'), el('b')])
    const before = document.getChildren(code.id).map((node) => node.id)

    applyCodeTree(document, code.id, [el('b'), el('a')])
    const after = document.getChildren(code.id)
    expect(after.map((node) => node.sourceKey)).toEqual(['b', 'a'])
    // Same two nodes, reordered, not rebuilt.
    expect(new Set(after.map((node) => node.id))).toEqual(new Set(before))
  })

  it('removes what a run stopped producing', () => {
    const { document, code } = withCode()
    applyCodeTree(document, code.id, [el('a'), el('b'), el('c')])
    applyCodeTree(document, code.id, [el('b')])
    expect(document.getChildren(code.id).map((node) => node.sourceKey)).toEqual(['b'])
  })

  it('rebuilds when a key changes type, since a rectangle cannot become a frame in place', () => {
    const { document, code } = withCode()
    applyCodeTree(document, code.id, [el('a', 'rectangle')])
    const before = document.getChildren(code.id)[0]?.id

    applyCodeTree(document, code.id, [el('a', 'frame')])
    const after = document.getChildren(code.id)[0]
    expect(after?.type).toBe('frame')
    expect(after?.id).not.toBe(before)
  })

  it('leaves the document untouched when nothing changed', () => {
    const { document, code } = withCode()
    const tree = [
      el('a', 'frame', {
        props: { width: 200, height: 100, background: '#ffffff', gap: 8, direction: 'row' },
        children: [el('a/x'), el('a/y', 'text', { text: 'hi', props: { fontSize: 14 } })],
      }),
    ]
    applyCodeTree(document, code.id, tree)
    const version = document.version

    applyCodeTree(document, code.id, tree)
    expect(document.version).toBe(version)
  })

  it('is one undo step however many nodes a run touches', () => {
    const { document, code } = withCode()
    applyCodeTree(document, code.id, [
      el('a', 'frame', { children: [el('a/1'), el('a/2'), el('a/3')] }),
    ])
    expect(document.historyDepth).toBe(1)

    document.undo()
    expect(document.getChildren(code.id)).toHaveLength(0)
  })

  it('maps flex props onto a frame layout with absent sizes hugging', () => {
    const { document, code } = withCode()
    applyCodeTree(document, code.id, [
      el('a', 'frame', { props: { direction: 'column', gap: 12, padding: 10, width: 240 } }),
    ])
    const frame = document.getChildren(code.id)[0]
    if (frame?.type !== 'frame') throw new Error('expected a frame')
    expect(frame.layout).toMatchObject({
      direction: 'vertical',
      gap: 12,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      // width on a column frame is the cross axis; the main axis has no height so it hugs.
      mainSizing: 'hug',
      crossSizing: 'fixed',
    })
  })

  it('turns grow into fill on the parent direction axis', () => {
    const { document, code } = withCode()
    applyCodeTree(document, code.id, [
      el('a', 'frame', {
        props: { direction: 'row', gap: 4 },
        children: [el('a/left', 'rectangle', { props: { grow: true, height: 40 } })],
      }),
    ])
    const frame = document.getChildren(code.id)[0]
    const child = frame ? document.getChildren(frame.id)[0] : undefined
    expect(child?.layoutChild).toEqual({ widthMode: 'fill', heightMode: 'fixed' })
  })

  it('measures text through the injected measurer in the same pass', () => {
    const { document, code } = withCode()
    applyCodeTree(
      document,
      code.id,
      [el('t', 'text', { text: 'Hello', props: { fontSize: 20 } })],
      () => ({ width: 55, height: 24 }),
    )
    const text = document.getChildren(code.id)[0]
    expect(text?.size).toEqual({ width: 55, height: 24 })
  })

  it('refuses a node that is not a code node', () => {
    const { document } = withCode()
    expect(() => applyCodeTree(document, document.rootId, [])).toThrow(/not a code node/)
  })
})

describe('generatedBounds', () => {
  it('is null with no output', () => {
    const { document, code } = withCode()
    expect(generatedBounds(document, code.id)).toBeNull()
  })

  it('unions the children boxes in code-local space', () => {
    const { document, code } = withCode()
    applyCodeTree(document, code.id, [
      el('a', 'rectangle', { props: { x: 0, y: 0, width: 100, height: 50 } }),
      el('b', 'rectangle', { props: { x: 150, y: 30, width: 60, height: 60 } }),
    ])
    expect(generatedBounds(document, code.id)).toEqual({ x: 0, y: 0, width: 210, height: 90 })
  })
})
