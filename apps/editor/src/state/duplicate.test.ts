import { describe, expect, it } from 'vitest'
import { SceneDocument, createFrame, createRectangle, translation } from '@figma-canvas/document'
import { duplicateNodes } from './duplicate'

function scene() {
  const document = new SceneDocument()
  const frame = document.insert(createFrame({ name: 'F', transform: translation(-160, -120) }))
  const rectangle = document.insert(
    createRectangle({
      name: 'R',
      transform: translation(24, 24),
      size: { width: 100, height: 50 },
    }),
    frame.id,
  )
  document.clearHistory()
  return { document, frame, rectangle }
}

describe('duplicateNodes', () => {
  it('copies onto the original when there is no offset, which is what option drag needs', () => {
    const { document, frame, rectangle } = scene()
    const [copy] = duplicateNodes(document, [rectangle.id], { x: 0, y: 0 })
    if (!copy) throw new Error('nothing was duplicated')

    expect(copy.transform.tx).toBe(24)
    expect(copy.parent).toBe(frame.id)
    expect(document.getChildren(frame.id)).toHaveLength(2)
    expect(document.historyDepth).toBe(1)
  })

  it('offsets the copy when asked, which is what Cmd+D needs', () => {
    const { document, rectangle } = scene()
    const [copy] = duplicateNodes(document, [rectangle.id], { x: 10, y: 10 })
    expect(copy?.transform.tx).toBe(34)
  })

  it('leaves the original alone when the copy moves', () => {
    const { document, rectangle } = scene()
    const [copy] = duplicateNodes(document, [rectangle.id], { x: 0, y: 0 })
    if (!copy) throw new Error('nothing was duplicated')

    document.update(copy.id, { transform: translation(200, 200) })
    expect(document.expectNode(copy.id).transform.tx).toBe(200)
    expect(document.expectNode(rectangle.id).transform.tx).toBe(24)
  })

  it('makes the copy and the whole drag that follows a single undo step', () => {
    const { document, rectangle } = scene()

    document.beginHistoryGroup()
    const [copy] = duplicateNodes(document, [rectangle.id], { x: 0, y: 0 })
    if (!copy) throw new Error('nothing was duplicated')
    for (let x = 1; x <= 20; x += 1) {
      document.transact(() => document.update(copy.id, { transform: translation(x, 0) }))
    }
    document.endHistoryGroup()

    expect(document.historyDepth).toBe(1)
    const before = document.size

    document.undo()
    expect(document.size).toBe(before - 1)
    expect(document.expectNode(rectangle.id).transform.tx).toBe(24)
  })
})
