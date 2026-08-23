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
import { componentSpec, componentSpecs } from '../components/registry'
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
    expect(Object.keys(node.props).sort()).toEqual(['disabled', 'label'])
    expect(node.component).toBe('button')
  })

  it('is one undo step, however much the drop had to write', () => {
    const document = new SceneDocument()
    const frame = document.insert(createFrame({ size: { width: 400, height: 300 } }))
    document.clearHistory()

    const node = insertComponent(document, spec('accordion'), frame.id, { x: 100, y: 100 })
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
    // The prop the change said nothing about, which a merge keeps and an assign would drop.
    expect(after.props['disabled']).toBe(false)
  })

  it('is one undo step per commit, and undo puts the old props back', () => {
    const document = new SceneDocument()
    const node = insertComponent(document, spec('button'), document.rootId, { x: 0, y: 0 })
    document.clearHistory()

    updateComponentProps(document, document.expectNode(node.id) as ComponentNode, {
      disabled: true,
    })
    expect(document.historyDepth).toBe(1)
    document.undo()
    expect((document.expectNode(node.id) as ComponentNode).props['disabled']).toBe(false)
  })
})

describe('the registry', () => {
  /*
   * Pinned deliberately, in the spirit of the test on `SCHEMA_VERSION`: the library is read off
   * disk, so adding or removing a file changes what the app offers with no code change anywhere
   * to notice. This is the thing that notices.
   */
  it('offers exactly the library on disk', () => {
    expect(componentSpecs().map((entry) => entry.key)).toEqual([
      'accordion',
      'avatar',
      'button',
      'checkbox',
      'input',
      'progress',
      'radiogroup',
      'select',
      'separator',
      'slider',
      'switch',
      'tabs',
      'togglegroup',
    ])
  })

  // Radix does the behaviour and each file is a thin wrapper, so the props the panel offers
  // are the wrapper's own and never the primitive's callbacks and elements.
  it('describes a wrapper by its own scalar signature', () => {
    expect(componentSpec('switch')?.props.map((prop) => prop.key)).toEqual([
      'label',
      'checked',
      'disabled',
    ])
  })

  it('records where each one would be imported from, which nothing else can recover', () => {
    expect(button()?.importPath).toBe('components/library/Button')
    expect(button()?.exportName).toBe('Button')
  })

  it('answers undefined for a component this build does not ship, rather than throwing', () => {
    expect(componentSpec('carousel')).toBeUndefined()
  })
})
