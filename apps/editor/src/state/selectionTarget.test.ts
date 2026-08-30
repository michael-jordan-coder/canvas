import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createCode,
  createFrame,
  createRectangle,
  createText,
} from '@canvas/document'
import {
  deepSelectionTarget,
  descendSelectionTarget,
  selectionTarget,
} from './selectionTarget'

/** Page > outer > inner > rect, plus a rect sitting directly on the page. */
function scene() {
  const document = new SceneDocument()
  const outer = document.insert(createFrame({ size: { width: 400, height: 400 } }))
  const inner = document.insert(
    createFrame({ size: { width: 200, height: 200 } }),
    outer.id,
  )
  const rect = document.insert(
    createRectangle({ size: { width: 50, height: 50 } }),
    inner.id,
  )
  const sibling = document.insert(
    createRectangle({ size: { width: 50, height: 50 } }),
    inner.id,
  )
  const loose = document.insert(createRectangle({ size: { width: 50, height: 50 } }))
  return { document, outer, inner, rect, sibling, loose }
}

describe('selectionTarget', () => {
  it('stops one level inside the top-level frame, not at the shape', () => {
    const { document, inner, rect } = scene()
    expect(selectionTarget(document, rect.id, null).id).toBe(inner.id)
  })

  it('leaves the context on the top-level frame it stopped inside', () => {
    const { document, outer, rect } = scene()
    expect(selectionTarget(document, rect.id, null).context).toBe(outer.id)
  })

  it('does not let a top-level frame swallow its own child', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ size: { width: 400, height: 400 } }))
    const rect = document.insert(createRectangle({ size: { width: 50, height: 50 } }), frame.id)
    expect(selectionTarget(document, rect.id, null).id).toBe(rect.id)
  })

  it('takes a node sitting directly on the page as itself', () => {
    const { document, loose } = scene()
    expect(selectionTarget(document, loose.id, null)).toEqual({ id: loose.id, context: null })
  })

  it('keeps clicks at the level that was entered', () => {
    const { document, inner, rect, sibling } = scene()
    expect(selectionTarget(document, rect.id, inner.id).id).toBe(rect.id)
    expect(selectionTarget(document, sibling.id, inner.id).id).toBe(sibling.id)
  })

  it('holds the context steady while clicking siblings inside it', () => {
    const { document, inner, sibling } = scene()
    expect(selectionTarget(document, sibling.id, inner.id).context).toBe(inner.id)
  })

  it('steps back out when the entered container itself is clicked', () => {
    const { document, outer, inner } = scene()
    // Not a click inside `inner`, so it resolves as a fresh one and selects the container.
    expect(selectionTarget(document, inner.id, inner.id)).toEqual({
      id: inner.id,
      context: outer.id,
    })
  })

  it('falls back to the default when the context no longer holds the hit', () => {
    const { document, inner, loose } = scene()
    expect(selectionTarget(document, loose.id, inner.id)).toEqual({
      id: loose.id,
      context: null,
    })
  })

  it('treats a deleted context as no context at all', () => {
    const { document, inner, rect } = scene()
    const stale = inner.id
    document.remove(inner.id)
    const orphan = document.insert(createRectangle({ size: { width: 10, height: 10 } }))
    expect(selectionTarget(document, orphan.id, stale)).toEqual({ id: orphan.id, context: null })
    expect(document.getNode(rect.id)).toBeUndefined()
  })

  it('never treats the page as an entered context', () => {
    const { document, inner, rect } = scene()
    expect(selectionTarget(document, rect.id, document.rootId).id).toBe(inner.id)
  })
})

describe('deepSelectionTarget', () => {
  it('takes the deepest node, whatever the hierarchy says', () => {
    const { document, inner, rect } = scene()
    expect(deepSelectionTarget(document, rect.id)).toEqual({ id: rect.id, context: inner.id })
  })

  it('leaves no context behind for a node that sits on the page', () => {
    const { document, loose } = scene()
    expect(deepSelectionTarget(document, loose.id).context).toBeNull()
  })
})

describe('descendSelectionTarget', () => {
  it('goes one level further in than a plain click', () => {
    const { document, inner, rect } = scene()
    expect(descendSelectionTarget(document, rect.id, null)).toEqual({
      id: rect.id,
      context: inner.id,
    })
  })

  it('is null once the plain click already reaches the hit', () => {
    const { document, inner, rect } = scene()
    expect(descendSelectionTarget(document, rect.id, inner.id)).toBeNull()
  })

  it('reaches a text node one double click at a time', () => {
    const document = new SceneDocument()
    const outer = document.insert(createFrame({ size: { width: 400, height: 400 } }))
    const middle = document.insert(createFrame({ size: { width: 200, height: 200 } }), outer.id)
    const text = document.insert(createText({ characters: 'hi' }), middle.id)

    // A plain click stops at `middle`; the first double click descends to the text, and only
    // then is there nothing left to descend into and the caller may open it for editing.
    expect(selectionTarget(document, text.id, null).id).toBe(middle.id)
    const first = descendSelectionTarget(document, text.id, null)
    expect(first).toEqual({ id: text.id, context: middle.id })
    expect(descendSelectionTarget(document, text.id, first?.context ?? null)).toBeNull()
  })
})

describe('code node ownership', () => {
  /** A code node inside a frame, holding the tree a run would have left. */
  function withCode() {
    const document = new SceneDocument()
    const artboard = document.insert(createFrame({ size: { width: 400, height: 400 } }))
    const code = document.insert(
      createCode({ source: 'irrelevant', size: { width: 200, height: 100 } }),
      artboard.id,
    )
    const row = document.insert(
      createFrame({ locked: true, sourceKey: 'root', size: { width: 200, height: 40 } }),
      code.id,
    )
    const label = document.insert(
      createText({ locked: true, sourceKey: 'root/label', characters: 'hi' }),
      row.id,
    )
    return { document, artboard, code, row, label }
  }

  it('resolves a hit on generated output to the code node, however deep', () => {
    const { document, code, label } = withCode()
    expect(selectionTarget(document, label.id, null).id).toBe(code.id)
  })

  it('does not let Cmd reach inside either', () => {
    const { document, code, label } = withCode()
    expect(deepSelectionTarget(document, label.id).id).toBe(code.id)
  })

  it('keeps an entered context from selecting generated output', () => {
    const { document, code, row, label } = withCode()
    // Entered the code node itself: a click inside it still answers with the code node.
    expect(selectionTarget(document, label.id, code.id).id).toBe(code.id)
    // A stale context naming a generated node cannot pull the resolution inside.
    expect(selectionTarget(document, label.id, row.id).id).toBe(code.id)
  })

  it('bottoms descent out at the code node', () => {
    const { document, artboard, code, label } = withCode()
    // The plain click already stops at the code node one level inside the artboard.
    const plain = selectionTarget(document, label.id, null)
    expect(plain).toEqual({ id: code.id, context: artboard.id })
    const deeper = descendSelectionTarget(document, label.id, plain.context)
    expect(deeper).toBeNull()
  })

  it('leaves a code node itself selectable like any container', () => {
    const { document, artboard, code } = withCode()
    expect(selectionTarget(document, code.id, null)).toEqual({
      id: code.id,
      context: artboard.id,
    })
  })
})
