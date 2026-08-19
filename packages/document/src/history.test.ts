import { describe, expect, it } from 'vitest'
import { SceneDocument } from './document.js'
import { translation } from './math.js'
import { createEllipse, createFrame, createRectangle, type NodeId } from './node.js'

/** A document with history cleared, so the setup itself is not undoable. */
function fresh() {
  const document = new SceneDocument()
  const rectangle = document.insert(createRectangle({ transform: translation(0, 0) }))
  document.clearHistory()
  return { document, rectangle }
}

describe('undo and redo', () => {
  it('restores and reapplies a simple edit', () => {
    const { document, rectangle } = fresh()
    document.update(rectangle.id, { name: 'Renamed', opacity: 0.5 })

    document.undo()
    expect(document.expectNode(rectangle.id).name).toBe('Rectangle')
    expect(document.expectNode(rectangle.id).opacity).toBe(1)

    document.redo()
    expect(document.expectNode(rectangle.id).name).toBe('Renamed')
  })

  it('undoes an insert by removing the node and unlinking it', () => {
    const document = new SceneDocument()
    document.clearHistory()
    const rectangle = document.insert(createRectangle({}))

    document.undo()
    expect(document.getNode(rectangle.id)).toBeUndefined()
    expect(document.getChildren(document.rootId)).toEqual([])

    document.redo()
    expect(document.getNode(rectangle.id)).toBeDefined()
    expect(document.getChildren(document.rootId)).toHaveLength(1)
  })

  it('restores a deleted subtree with its children in order', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ name: 'F' }))
    document.insert(createRectangle({ name: 'A' }), frame.id)
    document.insert(createEllipse({ name: 'B' }), frame.id)
    document.insert(createRectangle({ name: 'C' }), frame.id)
    document.clearHistory()

    document.remove(frame.id)
    expect(document.size).toBe(1)

    document.undo()
    expect(document.getChildren(frame.id).map((node) => node.name)).toEqual(['A', 'B', 'C'])
    expect(document.expectNode(frame.id).parent).toBe(document.rootId)
  })

  it('puts a deleted middle child back between its siblings', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({}))
    document.insert(createRectangle({ name: 'A' }), frame.id)
    const middle = document.insert(createRectangle({ name: 'B' }), frame.id)
    document.insert(createRectangle({ name: 'C' }), frame.id)
    document.clearHistory()

    document.remove(middle.id)
    expect(document.getChildren(frame.id).map((node) => node.name)).toEqual(['A', 'C'])

    document.undo()
    expect(document.getChildren(frame.id).map((node) => node.name)).toEqual(['A', 'B', 'C'])
  })

  it('treats one transaction as one step', () => {
    const document = new SceneDocument()
    const a = document.insert(createRectangle({ transform: translation(0, 0) }))
    const b = document.insert(createRectangle({ transform: translation(0, 0) }))
    document.clearHistory()

    document.transact(() => {
      document.update(a.id, { transform: translation(50, 0) })
      document.update(b.id, { transform: translation(50, 0) })
    })
    expect(document.historyDepth).toBe(1)

    document.undo()
    expect(document.expectNode(a.id).transform.tx).toBe(0)
    expect(document.expectNode(b.id).transform.tx).toBe(0)
  })

  it('collapses a whole drag into one step', () => {
    const { document, rectangle } = fresh()

    document.beginHistoryGroup()
    for (let x = 1; x <= 60; x += 1) {
      document.transact(() => document.update(rectangle.id, { transform: translation(x, 0) }))
    }
    document.endHistoryGroup()

    expect(document.historyDepth).toBe(1)
    expect(document.expectNode(rectangle.id).transform.tx).toBe(60)

    document.undo()
    expect(document.expectNode(rectangle.id).transform.tx).toBe(0)
    document.redo()
    expect(document.expectNode(rectangle.id).transform.tx).toBe(60)
  })

  it('discards an aborted group, leaving no history step behind', () => {
    const { document, rectangle } = fresh()

    document.beginHistoryGroup()
    document.transact(() => document.update(rectangle.id, { transform: translation(30, 0) }))
    expect(document.expectNode(rectangle.id).transform.tx).toBe(30)

    document.abortHistoryGroup()
    expect(document.historyDepth).toBe(0)
    // Restoring the live node is the caller's job (cancelling a drag restores it before
    // aborting), so the value the transact left behind is still here: aborting only stops the
    // group from becoming an undo step, it does not itself roll anything back.
    expect(document.expectNode(rectangle.id).transform.tx).toBe(30)
    expect(document.undo()).toBe(false)
  })

  it('records nothing for a gesture that changed nothing', () => {
    const { document } = fresh()
    document.beginHistoryGroup()
    document.endHistoryGroup()
    expect(document.historyDepth).toBe(0)
  })

  it('discards the redo branch when a new edit lands', () => {
    const { document, rectangle } = fresh()
    document.update(rectangle.id, { name: 'one' })
    document.undo()
    expect(document.canRedo).toBe(true)

    document.update(rectangle.id, { name: 'two' })
    expect(document.canRedo).toBe(false)
    expect(document.expectNode(rectangle.id).name).toBe('two')
  })

  it('does not push a step for undo or redo themselves', () => {
    const { document, rectangle } = fresh()
    document.update(rectangle.id, { name: 'x' })
    expect(document.historyDepth).toBe(1)

    document.undo()
    expect(document.historyDepth).toBe(0)
    document.redo()
    expect(document.historyDepth).toBe(1)
  })

  it('keeps the past safe from later mutation of the live document', () => {
    const { document, rectangle } = fresh()
    document.update(rectangle.id, { transform: translation(5, 5) })
    document.undo()

    // If history held a reference rather than a clone, this would rewrite the past.
    document.expectNode(rectangle.id).transform.tx = 999
    document.redo()
    document.undo()
    expect(document.expectNode(rectangle.id).transform.tx).toBe(0)
  })

  it('notifies subscribers so the canvas redraws', () => {
    const { document, rectangle } = fresh()
    document.update(rectangle.id, { name: 'x' })

    let notified = 0
    document.subscribe(() => {
      notified += 1
    })
    const before = document.version

    document.undo()
    expect(document.version).toBeGreaterThan(before)
    expect(notified).toBe(1)
  })

  it('caps at 200 steps and drops the oldest', () => {
    const { document, rectangle } = fresh()
    for (let x = 1; x <= 205; x += 1) {
      document.update(rectangle.id, { transform: translation(x, 0) })
    }
    expect(document.historyDepth).toBe(200)

    let steps = 0
    while (document.undo()) steps += 1
    expect(steps).toBe(200)
    // The first five steps fell off, so it rewinds to 5 rather than to 0.
    expect(document.expectNode(rectangle.id).transform.tx).toBe(5)
  })

  it('returns false rather than throwing when there is nothing to undo', () => {
    const { document } = fresh()
    expect(document.undo()).toBe(false)
    expect(document.redo()).toBe(false)
  })
})

describe('side state', () => {
  it('carries selection through undo and redo', () => {
    const document = new SceneDocument()
    let selection: readonly NodeId[] = []
    document.setSideState<readonly NodeId[]>({
      capture: () => selection,
      restore: (value) => {
        selection = value
      },
    })

    const rectangle = document.insert(createRectangle({}))
    document.clearHistory()
    selection = [rectangle.id]

    document.transact(() => {
      document.remove(rectangle.id)
      selection = []
    })
    expect(selection).toEqual([])

    document.undo()
    expect(document.getNode(rectangle.id)).toBeDefined()
    expect(selection).toEqual([rectangle.id])

    document.redo()
    expect(selection).toEqual([])
  })
})
