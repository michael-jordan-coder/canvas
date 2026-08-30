import { beforeEach, describe, expect, it } from 'vitest'
import interRegular from '../../../../packages/renderer/src/font/inter-regular.json'

// Window fallback setup for node test environment prior to importing state modules
if (typeof window === 'undefined') {
  class DummyElement {}
  ;(globalThis as any).HTMLInputElement = DummyElement
  ;(globalThis as any).HTMLTextAreaElement = DummyElement
  ;(globalThis as any).HTMLSelectElement = DummyElement
  ;(globalThis as any).HTMLElement = DummyElement

  ;(globalThis as any).fetch = async () => {
    return {
      ok: true,
      json: async () => interRegular,
    } as any
  }

  const listeners: Record<string, ((event: any) => void)[]> = {}
  ;(globalThis as any).window = {
    location: { search: '' },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    addEventListener: (type: string, fn: any) => {
      listeners[type] = listeners[type] || []
      listeners[type].push(fn)
    },
    removeEventListener: (type: string, fn: any) => {
      listeners[type] = listeners[type]
        ? listeners[type].filter((f) => f !== fn)
        : []
    },
    dispatchEvent: (event: any) => {
      listeners[event.type]?.forEach((fn) => fn(event))
      return true
    },
  }
}

const { createFrame, createRectangle, fromHex, serializeSubtree } = await import('@canvas/document')
const { scene } = await import('../state/scene')
const { createClipboardInput } = await import('./clipboardInput')

type NodeId = import('@canvas/document').NodeId
type TextNode = import('@canvas/document').TextNode

function createMockClipboardEvent(text: string | null): ClipboardEvent {
  let defaultPrevented = false
  return {
    type: 'paste',
    target: null,
    clipboardData: text !== null ? { getData: (format: string) => (format === 'text/plain' ? text : '') } : null,
    preventDefault: () => {
      defaultPrevented = true
    },
    get defaultPrevented() {
      return defaultPrevented
    },
  } as unknown as ClipboardEvent
}

describe('clipboardInput plain text fallback', () => {
  let selection: readonly NodeId[] = []
  let cleanup: () => void

  beforeEach(() => {
    // Reset scene to empty page root
    const rootChildren = [...scene.getChildren(scene.rootId)]
    scene.transact(() => {
      for (const child of rootChildren) {
        scene.remove(child.id)
      }
    })
    scene.clearHistory()
    selection = []

    cleanup = createClipboardInput({
      document: scene,
      getSelection: () => selection,
      setSelection: (ids) => {
        selection = ids
      },
    })

    return () => {
      cleanup()
    }
  })

  it('creates a single text node when plain text is pasted', () => {
    const event = createMockClipboardEvent('Hello World')
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)

    const children = scene.getChildren(scene.rootId)
    expect(children.length).toBe(1)

    const node = children[0] as TextNode
    expect(node.type).toBe('text')
    expect(node.characters).toBe('Hello World')
    expect(node.fills).toEqual([fromHex('#1a1a1a')])
    expect(node.transform.tx).toBe(10)
    expect(node.transform.ty).toBe(10)

    // Verify newly created text node is selected
    expect(selection).toEqual([node.id])
  })

  it('pastes multiline text as a single text node', () => {
    const multilineText = 'First Line\nSecond Line\nThird Line'
    const event = createMockClipboardEvent(multilineText)
    window.dispatchEvent(event)

    const children = scene.getChildren(scene.rootId)
    expect(children.length).toBe(1)

    const node = children[0] as TextNode
    expect(node.type).toBe('text')
    expect(node.characters).toBe(multilineText)
    expect(selection).toEqual([node.id])
  })

  it('inserts pasted plain text into the selected frame destination', () => {
    let frameId: NodeId = '' as NodeId
    scene.transact(() => {
      const frame = scene.insert(
        createFrame({
          name: 'Target Frame',
          size: { width: 300, height: 200 },
        }),
      )
      frameId = frame.id
    })

    // Select the frame so destination() returns frameId
    selection = [frameId]

    const event = createMockClipboardEvent('Pasted inside frame')
    window.dispatchEvent(event)

    const frameChildren = scene.getChildren(frameId)
    expect(frameChildren.length).toBe(1)

    const node = frameChildren[0] as TextNode
    expect(node.type).toBe('text')
    expect(node.characters).toBe('Pasted inside frame')
    expect(node.parent).toBe(frameId)
    expect(selection).toEqual([node.id])
  })

  it('preserves existing Canvas subtree paste behavior when clipboard contains serialized subtree JSON', () => {
    let rectId: NodeId = '' as NodeId
    scene.transact(() => {
      const rect = scene.insert(
        createRectangle({
          name: 'Copied Rect',
          size: { width: 100, height: 100 },
        }),
      )
      rectId = rect.id
    })

    const subtree = serializeSubtree(scene, [rectId])
    const jsonText = JSON.stringify(subtree)

    const event = createMockClipboardEvent(jsonText)
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)

    const children = scene.getChildren(scene.rootId)
    // 1 original rect + 1 pasted clone
    expect(children.length).toBe(2)

    const pastedNode = children.find((n) => n.id !== rectId)!
    expect(pastedNode.type).toBe('rectangle')
    expect(pastedNode.name).toBe('Copied Rect')
    expect(selection).toEqual([pastedNode.id])
  })

  it('does nothing when clipboard is empty', () => {
    const event = createMockClipboardEvent('')
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    const children = scene.getChildren(scene.rootId)
    expect(children.length).toBe(0)
    expect(selection).toEqual([])
  })
})
