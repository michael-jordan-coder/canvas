import { describe, expect, it } from 'vitest'
import { SceneDocument } from './document.js'
import { containsPoint, hitTest } from './hit.js'
import { applyLayout, computeLayout, type NodeMeasurer } from './layout/autoLayout.js'
import { translation } from './math.js'
import {
  cloneNode,
  createComponent,
  createFrame,
  defaultFrameLayout,
  hasBounds,
  isPainted,
  type ComponentNode,
  type NodeId,
} from './node.js'
import {
  InvalidDocumentError,
  SCHEMA_VERSION,
  parseDocument,
  serializeDocument,
} from './serialize.js'

const button = (): ComponentNode =>
  createComponent({
    name: 'Button',
    component: 'button',
    props: { label: 'Click me', variant: 'primary', disabled: false, count: 3 },
    size: { width: 96, height: 32 },
  })

/**
 * A component node is the first node with bounds and no paint. The two questions used to be
 * the same one, and everything that asks the wrong one of them fails somewhere far away:
 * asking about paint in the packer is what keeps a component off the GPU, and asking about
 * bounds in hit testing is what makes one clickable.
 */
describe('a component node has bounds without having paint', () => {
  it('is not painted, so nothing packs it as a shape', () => {
    expect(isPainted(button())).toBe(false)
  })

  it('has bounds, so it can be hit tested and boxed', () => {
    expect(hasBounds(button())).toBe(true)
  })

  it('is clickable across its whole box', () => {
    const node = button()
    expect(containsPoint(node, { x: 48, y: 16 })).toBe(true)
    expect(containsPoint(node, { x: 95, y: 31 })).toBe(true)
    expect(containsPoint(node, { x: 97, y: 16 })).toBe(false)
  })

  it('is found under the pointer inside a frame, like any other node', () => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({ transform: translation(0, 0), size: { width: 300, height: 200 } }),
    )
    const node = document.insert(
      Object.assign(button(), { transform: translation(20, 20) }),
      frame.id,
    )
    expect(hitTest(document, { x: 40, y: 30 })?.id).toBe(node.id)
    // Just past the button's right edge: the frame under it, not the button.
    expect(hitTest(document, { x: 130, y: 30 })?.id).toBe(frame.id)
  })
})

describe('cloneNode on a component', () => {
  it('copies the props rather than sharing the bag', () => {
    const node = button()
    const clone = cloneNode(node) as ComponentNode
    expect(clone.props).toEqual(node.props)
    clone.props['label'] = 'Changed'
    expect(node.props['label']).toBe('Click me')
  })

  it('keeps the registry key and the auto size flag', () => {
    const node = createComponent({ component: 'input', autoSize: false })
    const clone = cloneNode(node) as ComponentNode
    expect(clone.component).toBe('input')
    expect(clone.autoSize).toBe(false)
  })
})

describe('serializing a component', () => {
  const documentWith = (node: ComponentNode): SceneDocument => {
    const document = new SceneDocument()
    document.insert(node)
    return document
  }

  it('round trips every field through the save format', () => {
    const node = button()
    const file = serializeDocument(documentWith(node))
    const read = parseDocument(JSON.parse(JSON.stringify(file)) as unknown)
    const parsed = read.nodes.find((other) => other.id === node.id) as ComponentNode
    expect(read.version).toBe(SCHEMA_VERSION)
    expect(parsed.type).toBe('component')
    expect(parsed.component).toBe('button')
    expect(parsed.props).toEqual(node.props)
    expect(parsed.autoSize).toBe(true)
  })

  it('accepts a component key this build does not ship, since that is a valid file', () => {
    const file = serializeDocument(documentWith(createComponent({ component: 'not-in-registry' })))
    expect(() => parseDocument(JSON.parse(JSON.stringify(file)) as unknown)).not.toThrow()
  })

  it('names the prop that is the wrong shape rather than saying invalid', () => {
    const file = JSON.parse(JSON.stringify(serializeDocument(documentWith(button())))) as {
      nodes: Record<string, unknown>[]
    }
    const node = file.nodes.find((other) => other['type'] === 'component')
    node!['props'] = { label: { nested: true } }
    expect(() => parseDocument(file)).toThrow(InvalidDocumentError)
    expect(() => parseDocument(file)).toThrow(/props\.label/)
  })

  it('refuses a component node with no props object at all', () => {
    const file = JSON.parse(JSON.stringify(serializeDocument(documentWith(button())))) as {
      nodes: Record<string, unknown>[]
    }
    const node = file.nodes.find((other) => other['type'] === 'component')
    delete node!['props']
    expect(() => parseDocument(file)).toThrow(/props is not an object/)
  })
})

/**
 * A component inside auto layout is the second reason the measurer takes a `SceneNode` rather
 * than a `TextNode`. Its height follows from the width it is handed, exactly as text's does,
 * and the engine cannot work either of them out on its own.
 */
describe('a component inside an auto layout frame', () => {
  /** Twice as tall as it is narrow: a shape that makes a re-measurement obvious. */
  const measurer: NodeMeasurer = {
    measure: (node, width) =>
      node.type === 'component' ? { width, height: Math.round(2000 / width) } : null,
  }

  const stack = (): {
    document: SceneDocument
    frameId: NodeId
    node: ComponentNode
  } => {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        size: { width: 300, height: 200 },
        layout: {
          ...defaultFrameLayout('vertical'),
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      }),
    )
    const node = document.insert(
      createComponent({
        component: 'card',
        size: { width: 100, height: 50 },
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    ) as ComponentNode
    return { document, frameId: frame.id, node }
  }

  it('is measured again at the width the layout gives it', () => {
    const { document, frameId, node } = stack()
    applyLayout(document, computeLayout(document, frameId, measurer))
    const after = document.expectNode(node.id)
    expect(after.size.width).toBe(300)
    // The stub's height at 300 wide, and emphatically not the 50 it was created with.
    expect(after.size.height).toBe(7)
  })

  it('keeps the height it has when there is nothing to measure with', () => {
    const { document, frameId, node } = stack()
    applyLayout(document, computeLayout(document, frameId, { measure: () => null }))
    expect(document.expectNode(node.id).size.height).toBe(50)
  })

  it('settles, so a second pass finds nothing left to do', () => {
    const { document, frameId } = stack()
    applyLayout(document, computeLayout(document, frameId, measurer))
    expect(computeLayout(document, frameId, measurer)).toEqual([])
  })

  it('is never stretched to fill a height it measures for itself', () => {
    const { document, frameId, node } = stack()
    document.update(node.id, { layoutChild: { widthMode: 'fixed', heightMode: 'fill' } })
    applyLayout(document, computeLayout(document, frameId, measurer))
    // Fill height would have made it the frame's whole 200. Its own measurement wins.
    expect(document.expectNode(node.id).size.height).toBe(50)
  })

  it('takes a hand set box at face value once it has been resized', () => {
    const { document, frameId, node } = stack()
    document.update<ComponentNode>(node.id, { autoSize: false })
    applyLayout(document, computeLayout(document, frameId, measurer))
    // The width is still the layout's to assign; the height is no longer measured.
    expect(document.expectNode(node.id).size.height).toBe(50)
  })
})
