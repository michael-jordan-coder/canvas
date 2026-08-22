import { describe, expect, it } from 'vitest'
import {
  SceneDocument,
  createFrame,
  createRectangle,
  defaultFrameLayout,
  translation,
  type ComponentNode,
  type FrameNode,
} from '@figma-canvas/document'
import { componentSpec } from '../components/registry'
import { insertComponent, updateComponentProps } from './componentNodes'

/*
 * These run in Node, where there is no DOM to measure a component in, which is deliberate
 * rather than a limitation being worked around: `measureComponentSize` answers null there,
 * so what is under test here is the placement and the document writes, with the size falling
 * back to the registry's declared one. What the components actually render at is a question
 * for a browser, and it is answered in one.
 */

const button = (): ReturnType<typeof componentSpec> => componentSpec('button')

function spec(key: string) {
  const found = componentSpec(key)
  if (!found) throw new Error(`no ${key} in the registry`)
  return found
}

describe('dropping a component into a plain frame', () => {
  it('centres it on the point it was dropped at', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ transform: translation(0, 0), size: { width: 400, height: 300 } }),
    )
    const node = insertComponent(document, spec('button'), frame.id, { x: 200, y: 150 })

    expect(node.parent).toBe(frame.id)
    expect(node.transform.tx).toBeCloseTo(200 - node.size.width / 2, 6)
    expect(node.transform.ty).toBeCloseTo(150 - node.size.height / 2, 6)
  })

  it('starts auto sized, with every prop the registry declares', () => {
    const document = new SceneDocument()
    const node = insertComponent(document, spec('button'), document.rootId, { x: 0, y: 0 })
    expect(node.autoSize).toBe(true)
    expect(Object.keys(node.props).sort()).toEqual(['disabled', 'label', 'size', 'variant'])
    expect(node.component).toBe('button')
  })

  it('is one undo step, however much the drop had to write', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ size: { width: 400, height: 300 } }))
    document.clearHistory()

    const node = insertComponent(document, spec('card'), frame.id, { x: 100, y: 100 })
    expect(document.historyDepth).toBe(1)
    document.undo()
    expect(document.getNode(node.id)).toBeUndefined()
  })
})

/**
 * The rule this file exists for. Dropping into a stack is asking for a place in the flow, so
 * the point becomes an index and the layout decides the coordinates. A transform written here
 * would be overwritten by the very next layout pass, which is what "prefer a semantic
 * operation over generated coordinates" means in practice.
 */
describe('dropping a component into an auto layout frame', () => {
  const stack = (): { document: SceneDocument; frame: FrameNode } => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 400, height: 200 },
        layout: { ...defaultFrameLayout('horizontal'), gap: 10 },
      }),
    ) as FrameNode
    // Two children already in the flow, at 10 and 120 along it.
    document.insert(
      createRectangle({ transform: translation(10, 10), size: { width: 100, height: 40 } }),
      frame.id,
    )
    document.insert(
      createRectangle({ transform: translation(120, 10), size: { width: 100, height: 40 } }),
      frame.id,
    )
    return { document, frame }
  }

  it('inserts at the front when dropped before the first child', () => {
    const { document, frame } = stack()
    const node = insertComponent(document, spec('button'), frame.id, { x: 5, y: 30 })
    expect(document.expectNode(frame.id).children.indexOf(node.id)).toBe(0)
  })

  it('inserts between two children when dropped between them', () => {
    const { document, frame } = stack()
    const node = insertComponent(document, spec('button'), frame.id, { x: 115, y: 30 })
    expect(document.expectNode(frame.id).children.indexOf(node.id)).toBe(1)
  })

  it('inserts at the end when dropped past the last child', () => {
    const { document, frame } = stack()
    const node = insertComponent(document, spec('button'), frame.id, { x: 380, y: 30 })
    expect(document.expectNode(frame.id).children.indexOf(node.id)).toBe(2)
  })

  it('does not place it at the pointer, since that is the layout to decide', () => {
    const { document, frame } = stack()
    const node = insertComponent(document, spec('button'), frame.id, { x: 380, y: 30 })
    const placed = document.expectNode(node.id)
    // Wherever the layout puts it, it is not the box centred on a pointer 380 across.
    expect(placed.transform.tx).not.toBeCloseTo(380 - placed.size.width / 2, 6)
  })
})

describe('editing props', () => {
  it('merges into what is there rather than replacing the bag', () => {
    const document = new SceneDocument()
    const node = insertComponent(document, spec('button'), document.rootId, { x: 0, y: 0 })

    updateComponentProps(document, document.expectNode(node.id) as ComponentNode, {
      label: 'Save',
    })
    const after = document.expectNode(node.id) as ComponentNode

    expect(after.props['label']).toBe('Save')
    expect(after.props['variant']).toBe('primary')
  })

  it('is one undo step per commit, and undo puts the old props back', () => {
    const document = new SceneDocument()
    const node = insertComponent(document, spec('button'), document.rootId, { x: 0, y: 0 })
    document.clearHistory()

    updateComponentProps(document, document.expectNode(node.id) as ComponentNode, {
      variant: 'danger',
    })
    expect(document.historyDepth).toBe(1)
    document.undo()
    expect((document.expectNode(node.id) as ComponentNode).props['variant']).toBe('primary')
  })
})

describe('the registry', () => {
  it('has the three components the panel offers', () => {
    expect(componentSpec('button')?.name).toBe('Button')
    expect(componentSpec('input')?.name).toBe('Input')
    expect(componentSpec('card')?.name).toBe('Card')
  })

  it('records where each one would be imported from, which nothing else can recover', () => {
    expect(button()?.importPath).toBe('components/library/Button')
    expect(button()?.exportName).toBe('Button')
  })

  it('answers undefined for a component this build does not ship, rather than throwing', () => {
    expect(componentSpec('carousel')).toBeUndefined()
  })
})
