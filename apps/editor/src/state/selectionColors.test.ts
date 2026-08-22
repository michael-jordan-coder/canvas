import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createFrame,
  createRectangle,
  fromHex,
  type Stroke,
} from '@figma-canvas/document'
import { tallySelectionColors } from './selectionColors'

describe('tallySelectionColors', () => {
  it('counts a fill once per node that draws it', () => {
    const document = new SceneDocument()
    document.insert(createRectangle({ fills: [fromHex('#ff0000')] }))
    document.insert(createRectangle({ fills: [fromHex('#ff0000')] }))
    document.insert(createRectangle({ fills: [fromHex('#00ff00')] }))

    const selection = document.getChildren(document.rootId).map((node) => node.id)
    const tally = tallySelectionColors(document, selection)

    expect(tally).toEqual([
      { hex: '#ff0000', count: 2 },
      { hex: '#00ff00', count: 1 },
    ])
  })

  it('walks a selected frame into its children', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ fills: [fromHex('#111111')] }))
    document.insert(createRectangle({ fills: [fromHex('#222222')] }), frame.id)

    const tally = tallySelectionColors(document, [frame.id])

    expect(tally).toEqual([
      { hex: '#111111', count: 1 },
      { hex: '#222222', count: 1 },
    ])
  })

  it('does not double count a child selected alongside its own parent', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ fills: [fromHex('#111111')] }))
    const child = document.insert(createRectangle({ fills: [fromHex('#222222')] }), frame.id)

    const tally = tallySelectionColors(document, [frame.id, child.id])

    expect(tally.find((entry) => entry.hex === '#222222')?.count).toBe(1)
  })

  it('ignores a hidden fill and a weightless stroke', () => {
    const document = new SceneDocument()
    const hiddenStroke: Stroke = { paint: fromHex('#0000ff'), weight: 0, align: 'inside' }
    const node = document.insert(
      createRectangle({
        fills: [{ ...fromHex('#ff0000'), visible: false }],
        strokes: [hiddenStroke],
      }),
    )

    const tally = tallySelectionColors(document, [node.id])

    expect(tally).toEqual([])
  })

  it('counts a fill and a stroke of the same colour as one swatch', () => {
    const document = new SceneDocument()
    const node = document.insert(
      createRectangle({
        fills: [fromHex('#abcdef')],
        strokes: [{ paint: fromHex('#abcdef'), weight: 1, align: 'inside' }],
      }),
    )

    const tally = tallySelectionColors(document, [node.id])

    expect(tally).toEqual([{ hex: '#abcdef', count: 2 }])
  })

  it('returns nothing for an empty selection', () => {
    const document = new SceneDocument()
    document.insert(createRectangle({ fills: [fromHex('#ff0000')] }))

    expect(tallySelectionColors(document, [])).toEqual([])
  })
})
