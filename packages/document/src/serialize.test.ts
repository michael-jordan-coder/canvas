import { describe, expect, it } from 'vitest'
import { SceneDocument } from './document.js'
import { translation } from './math.js'
import {
  createCode,
  createEllipse,
  createFrame,
  createRectangle,
  createText,
  type RectangleNode,
  type SceneNode,
  type TextNode,
} from './node.js'
import { fromHex, type Paint } from './paint.js'
import { uniformCornerRadii } from './sdf.js'

/**
 * A serialized file rewound to the shape it had before version 5: one `cornerRadius` scalar
 * where there are now four radii. Relabelling the version alone would leave a file no build
 * ever wrote, and the migration would then be tested against a fixture rather than against
 * what an older save actually looks like.
 */
function withScalarRadius(file: { nodes: readonly unknown[]; version: number }): unknown {
  const copy = JSON.parse(JSON.stringify(file)) as { nodes: Record<string, unknown>[] }
  for (const node of copy.nodes) {
    const radii = node['cornerRadii']
    if (radii === undefined) continue
    node['cornerRadius'] = (radii as { topLeft: number }).topLeft
    delete node['cornerRadii']
  }
  return copy
}
import {
  InvalidDocumentError,
  SCHEMA_VERSION,
  instantiateSubtree,
  parseDocument,
  parseSubtree,
  serializeDocument,
  serializeSubtree,
} from './serialize.js'

function scene() {
  const document = new SceneDocument()
  const frame = document.insert(
    createFrame({
      name: 'Frame 1',
      transform: translation(-160, -120),
      size: { width: 320, height: 240 },
      fills: [fromHex('#ffffff')],
    }),
  )
  const rectangle = document.insert(
    createRectangle({
      name: 'Rectangle',
      transform: translation(24, 24),
      size: { width: 140, height: 90 },
      fills: [fromHex('#0a7cff')],
      cornerRadii: uniformCornerRadii(4),
    }),
    frame.id,
  )
  document.insert(
    createEllipse({
      name: 'Ellipse',
      transform: translation(170, 130),
      size: { width: 90, height: 90 },
    }),
    frame.id,
  )
  return { document, frame, rectangle }
}

/** Everything that has to survive a round trip. */
const shapeOf = (document: SceneDocument): unknown =>
  [...document.walk()].map((node: SceneNode) => ({
    id: node.id,
    type: node.type,
    name: node.name,
    parent: node.parent,
    children: node.children,
    transform: node.transform,
    size: node.size,
    opacity: node.opacity,
    visible: node.visible,
    fills: 'fills' in node ? node.fills : undefined,
  }))

/** Through actual JSON, so anything unserialisable shows up. */
const roundTrip = (document: SceneDocument): SceneDocument => {
  const parsed = parseDocument(JSON.parse(JSON.stringify(serializeDocument(document))) as unknown)
  const loaded = new SceneDocument()
  loaded.load(parsed.root, parsed.nodes)
  return loaded
}

describe('document round trip', () => {
  it('reproduces the tree exactly', () => {
    const { document } = scene()
    const loaded = roundTrip(document)
    expect(shapeOf(loaded)).toEqual(shapeOf(document))
    expect(loaded.rootId).toBe(document.rootId)
    expect(loaded.size).toBe(document.size)
  })

  it('does not let a newly created node collide with a loaded id', () => {
    const { document } = scene()
    const loaded = roundTrip(document)

    const added = loaded.insert(createRectangle({ name: 'After load' }))
    expect(loaded.expectNode(added.id).name).toBe('After load')
    expect(loaded.size).toBe(document.size + 1)
  })

  it('notifies once and is not undoable', () => {
    const { document } = scene()
    const target = new SceneDocument()
    target.insert(createRectangle({ name: 'Old' }))

    let notified = 0
    target.subscribe(() => {
      notified += 1
    })

    const parsed = parseDocument(JSON.parse(JSON.stringify(serializeDocument(document))) as unknown)
    target.load(parsed.root, parsed.nodes)

    expect(notified).toBe(1)
    expect(target.canUndo).toBe(false)
  })
})

describe('validation', () => {
  const page = {
    id: 'n1',
    type: 'page',
    name: 'p',
    visible: true,
    locked: false,
    opacity: 1,
    parent: null,
    children: [],
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    size: { width: 0, height: 0 },
  }

  it('rejects json that is not ours', () => {
    expect(() => parseDocument({ hello: 'world' })).toThrow(InvalidDocumentError)
  })

  it('names the field that failed', () => {
    expect(() =>
      parseDocument({
        kind: 'figma-canvas/document',
        version: 1,
        root: 'n1',
        nodes: [{ ...page, opacity: 'nope' }],
      }),
    ).toThrow(/nodes\[0\]\.opacity is not a finite number/)
  })

  it('refuses a schema from the future rather than half reading it', () => {
    expect(() =>
      parseDocument({ kind: 'figma-canvas/document', version: 99, root: 'n1', nodes: [page] }),
    ).toThrow(/version 99/)
  })

  it('rejects a root that is not in the file', () => {
    expect(() =>
      parseDocument({ kind: 'figma-canvas/document', version: 1, root: 'nX', nodes: [] }),
    ).toThrow(/root does not name a node/)
  })

  it('rejects an unknown node type', () => {
    expect(() =>
      parseDocument({
        kind: 'figma-canvas/document',
        version: 1,
        root: 'n1',
        nodes: [{ ...page, type: 'hologram' }],
      }),
    ).toThrow(/is not a node type/)
  })
})

describe('copy and paste', () => {
  it('takes the children along with the node', () => {
    const { document, frame } = scene()
    const subtree = serializeSubtree(document, [frame.id])
    expect(subtree.nodes).toHaveLength(3)
    expect(subtree.roots).toHaveLength(1)
  })

  it('collapses a selection that contains both a parent and its child', () => {
    const { document, frame, rectangle } = scene()
    const subtree = serializeSubtree(document, [frame.id, rectangle.id])
    expect(subtree.roots).toEqual([frame.id])
    expect(subtree.nodes.filter((node) => node.name === 'Rectangle')).toHaveLength(1)
  })

  it('pastes a copy that is independent of the original', () => {
    const { document, frame } = scene()
    const before = document.size

    const parsed = parseSubtree(
      JSON.parse(JSON.stringify(serializeSubtree(document, [frame.id]))) as unknown,
    )
    const created = instantiateSubtree(document, parsed, document.rootId, { x: 10, y: 10 })
    const copy = created[0]
    if (!copy) throw new Error('paste produced nothing')

    expect(document.size).toBe(before + 3)
    expect(copy.id).not.toBe(frame.id)
    expect(document.getChildren(copy.id).map((node) => node.name)).toEqual([
      'Rectangle',
      'Ellipse',
    ])
    expect(document.expectNode(copy.id).transform.tx).toBe(-150)
    // Children keep their own local positions, only the root is offset.
    expect(document.getChildren(copy.id)[0]?.transform.tx).toBe(24)

    document.update(copy.id, { name: 'Copy' })
    expect(document.expectNode(frame.id).name).toBe('Frame 1')
  })

  it('is a single undo step however many nodes it contains', () => {
    const { document, frame } = scene()
    document.clearHistory()

    instantiateSubtree(document, serializeSubtree(document, [frame.id]), document.rootId, {
      x: 10,
      y: 10,
    })
    expect(document.historyDepth).toBe(1)

    document.undo()
    expect(document.size).toBe(4)
  })
})

describe('the text node on disk', () => {
  function withText() {
    const document = new SceneDocument()
    const text = document.insert(
      createText({
        name: 'Heading',
        transform: translation(40, 60),
        size: { width: 120, height: 30 },
        characters: 'Hello\nthere',
        fontSize: 24,
        fills: [fromHex('#1a1a1a')],
      }),
    )
    return { document, text }
  }

  it('survives a round trip through JSON with its text and size intact', () => {
    const { document, text } = withText()
    const parsed = parseDocument(JSON.parse(JSON.stringify(serializeDocument(document))))

    const restored = new SceneDocument()
    restored.load(parsed.root, parsed.nodes)
    const back = restored.expectNode(text.id)

    expect(back.type).toBe('text')
    if (back.type !== 'text') throw new Error('expected a text node')
    expect(back.characters).toBe('Hello\nthere')
    expect(back.fontSize).toBe(24)
    expect(back.size).toEqual({ width: 120, height: 30 })
  })

  it('is written at the current schema version', () => {
    const { document } = withText()
    expect(serializeDocument(document).version).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(6)
  })

  /*
   * The bump is not a migration. Nothing in a version 1 file needs changing, because a text
   * node could not appear in one and every other field is untouched. What it buys is the
   * other direction, where a build from before text refuses the file by version instead of
   * dying partway through on an unknown node type.
   */
  it('still loads a file written before text existed', () => {
    const { document } = scene()
    const older = { ...serializeDocument(document), version: 1 }
    expect(() => parseDocument(withScalarRadius(older))).not.toThrow()
  })

  it('names the field that failed rather than saying invalid', () => {
    const { document } = withText()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    const broken = file.nodes.find((node: { type: string }) => node.type === 'text')
    broken.fontSize = 'large'
    expect(() => parseDocument(file)).toThrow(/fontSize is not a finite number/)
  })

  it('refuses a text node with no characters field rather than assuming empty', () => {
    const { document } = withText()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    delete file.nodes.find((node: { type: string }) => node.type === 'text').characters
    expect(() => parseDocument(file)).toThrow(InvalidDocumentError)
  })

  /*
   * The first real migration. A version 2 file has text nodes with no `autoWidth`, and every
   * one of them predates fixed width boxes, so it was auto width. Defaulting the field
   * whatever the version says would let a genuinely malformed version 3 file through.
   */
  it('reads a version 2 text node as auto width, since that is all there was', () => {
    const { document } = withText()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    file.version = 2
    for (const node of file.nodes) delete node.autoWidth

    const parsed = parseDocument(file)
    const text = parsed.nodes.find((node) => node.type === 'text')
    expect(text?.type === 'text' && text.autoWidth).toBe(true)
  })

  it('still requires the field at the current version', () => {
    const { document } = withText()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    delete file.nodes.find((node: { type: string }) => node.type === 'text').autoWidth
    expect(() => parseDocument(file)).toThrow(/autoWidth/)
  })

  /*
   * The second real migration, and the same shape as the first. A version 4 file has one
   * radius per shape and it applied to every corner, so four equal radii is what it meant
   * rather than a guess at what it might have meant.
   */
  it('reads a version 4 corner radius as four equal radii', () => {
    const { document, rectangle } = scene()
    const file = withScalarRadius({ ...serializeDocument(document), version: 4 })

    const parsed = parseDocument(file)
    const back = parsed.nodes.find((node) => node.id === rectangle.id)
    expect(back?.type === 'rectangle' && back.cornerRadii).toEqual({
      topLeft: 4,
      topRight: 4,
      bottomRight: 4,
      bottomLeft: 4,
    })
  })

  it('still requires the four radii at the current version', () => {
    const { document } = scene()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    delete file.nodes.find((node: { type: string }) => node.type === 'rectangle').cornerRadii
    expect(() => parseDocument(file)).toThrow(/cornerRadii/)
  })

  it('round trips four different radii', () => {
    const { document, rectangle } = scene()
    document.update<RectangleNode>(rectangle.id, {
      cornerRadii: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
    })

    const parsed = parseDocument(JSON.parse(JSON.stringify(serializeDocument(document))))
    const back = parsed.nodes.find((node) => node.id === rectangle.id)
    expect(back?.type === 'rectangle' && back.cornerRadii).toEqual({
      topLeft: 1,
      topRight: 2,
      bottomRight: 3,
      bottomLeft: 4,
    })
  })

  it('round trips a fixed width box', () => {
    const { document, text } = withText()
    document.update<TextNode>(text.id, { autoWidth: false, size: { width: 90, height: 60 } })

    const parsed = parseDocument(JSON.parse(JSON.stringify(serializeDocument(document))))
    const back = parsed.nodes.find((node) => node.id === text.id)
    expect(back?.type === 'text' && back.autoWidth).toBe(false)
    expect(back?.size).toEqual({ width: 90, height: 60 })
  })

  it('pastes as an independent copy, so editing one does not touch the other', () => {
    const { document, text } = withText()
    const [copy] = instantiateSubtree(
      document,
      serializeSubtree(document, [text.id]),
      document.rootId,
      { x: 10, y: 10 },
    )
    if (!copy) throw new Error('expected a copy')

    document.update<TextNode>(copy.id, { characters: 'Changed' })
    const original = document.expectNode(text.id)
    if (original.type !== 'text') throw new Error('expected a text node')
    expect(original.characters).toBe('Hello\nthere')
  })
})

describe('auto layout on disk', () => {
  function withLayout() {
    const document = new SceneDocument()
    const frame = document.insert(
      createFrame({
        name: 'Row',
        size: { width: 300, height: 100 },
        layout: {
          direction: 'horizontal',
          gap: 12,
          padding: { top: 4, right: 8, bottom: 4, left: 8 },
          mainAlign: 'space-between',
          crossAlign: 'center',
          mainSizing: 'fixed',
          crossSizing: 'hug',
        },
      }),
    )
    const child = document.insert(
      createRectangle({
        size: { width: 50, height: 50 },
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      }),
      frame.id,
    )
    return { document, frame, child }
  }

  it('round trips the frame layout and the child modes', () => {
    const { document, frame, child } = withLayout()
    const parsed = parseDocument(JSON.parse(JSON.stringify(serializeDocument(document))))

    const backFrame = parsed.nodes.find((node) => node.id === frame.id)
    expect(backFrame?.type === 'frame' && backFrame.layout).toEqual({
      direction: 'horizontal',
      gap: 12,
      padding: { top: 4, right: 8, bottom: 4, left: 8 },
      mainAlign: 'space-between',
      crossAlign: 'center',
      mainSizing: 'fixed',
      crossSizing: 'hug',
    })
    expect(parsed.nodes.find((node) => node.id === child.id)?.layoutChild).toEqual({
      widthMode: 'fill',
      heightMode: 'fixed',
    })
  })

  it('loads a version 3 file, where absence simply means no layout', () => {
    const { document } = scene()
    const older = { ...serializeDocument(document), version: 3 }
    const parsed = parseDocument(withScalarRadius(older))
    for (const node of parsed.nodes) {
      expect(node.layoutChild).toBeUndefined()
      if (node.type === 'frame') expect(node.layout).toBeUndefined()
    }
  })

  it('rejects a direction that is not one', () => {
    const { document } = withLayout()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    file.nodes.find((node: { type: string }) => node.type === 'frame').layout.direction =
      'diagonal'
    expect(() => parseDocument(file)).toThrow(/layout.direction "diagonal"/)
  })

  it('names a missing padding side by its path', () => {
    const { document } = withLayout()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    delete file.nodes.find((node: { type: string }) => node.type === 'frame').layout.padding.left
    expect(() => parseDocument(file)).toThrow(/layout.padding.left/)
  })

  it('clones the padding deeply, so history cannot be rewritten through it', () => {
    const { document, frame } = withLayout()
    const serialized = serializeDocument(document)
    const stored = serialized.nodes.find((node) => node.id === frame.id)
    if (stored?.type !== 'frame' || !stored.layout) throw new Error('expected the layout')

    const live = document.expectNode(frame.id)
    if (live.type !== 'frame' || !live.layout) throw new Error('expected the layout')
    live.layout.padding.left = 999
    expect(stored.layout.padding.left).toBe(8)
  })
})

describe('paint opacity and visibility on disk', () => {
  const FILLS: Paint[] = [
    { ...fromHex('#ff0000'), opacity: 0.25 },
    { ...fromHex('#00ff00'), visible: false },
    fromHex('#0000ff'),
  ]

  function stacked() {
    const document = new SceneDocument()
    const rectangle = document.insert(
      createRectangle({ size: { width: 100, height: 100 }, fills: FILLS }),
    )
    return { document, rectangle }
  }

  it('round trips a whole stack of fills with their own fields', () => {
    const { document, rectangle } = stacked()
    const loaded = roundTrip(document)
    const back = loaded.expectNode(rectangle.id)
    expect('fills' in back && back.fills).toEqual(FILLS)
  })

  // Absence is the default in the model, so a file written before the fields existed and a
  // paint that simply carries neither have to read the same. That is what buys no bump.
  it('leaves an absent field absent rather than writing in its default', () => {
    const { document, rectangle } = stacked()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    const written = file.nodes.find((node: { id: string }) => node.id === rectangle.id)
    expect(written.fills[2]).not.toHaveProperty('opacity')
    expect(written.fills[2]).not.toHaveProperty('visible')

    const parsed = parseDocument(file)
    const back = parsed.nodes.find((node) => node.id === rectangle.id)
    expect(back?.type === 'rectangle' && back.fills[2]).not.toHaveProperty('opacity')
  })

  it('reads a file at the current version that predates the fields', () => {
    const { document, rectangle } = stacked()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    for (const node of file.nodes) {
      for (const fill of node.fills ?? []) {
        delete fill.opacity
        delete fill.visible
      }
    }
    expect(file.version).toBe(SCHEMA_VERSION)

    const parsed = parseDocument(file)
    const back = parsed.nodes.find((node) => node.id === rectangle.id)
    const plain =
      back?.type === 'rectangle' && back.fills.every((fill) => fill.opacity === undefined)
    expect(plain).toBe(true)
  })

  it('names the paint field that failed by its own path', () => {
    const { document } = stacked()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    file.nodes.find((node: { type: string }) => node.type === 'rectangle').fills[0].opacity =
      'half'
    expect(() => parseDocument(file)).toThrow(/fills\[0\]\.opacity is not a finite number/)
  })

  it('rejects a visible flag that is not a boolean', () => {
    const { document } = stacked()
    const file = JSON.parse(JSON.stringify(serializeDocument(document)))
    file.nodes.find((node: { type: string }) => node.type === 'rectangle').fills[0].visible = 1
    expect(() => parseDocument(file)).toThrow(/fills\[0\]\.visible is not a boolean/)
  })

  it('carries the fields on a stroke paint too', () => {
    const document = new SceneDocument()
    const rectangle = document.insert(
      createRectangle({
        size: { width: 100, height: 100 },
        strokes: [
          {
            paint: { ...fromHex('#1a1a1a'), opacity: 0.5, visible: false },
            weight: 3,
            align: 'outside',
          },
        ],
      }),
    )
    const back = roundTrip(document).expectNode(rectangle.id)
    expect('strokes' in back && back.strokes[0]?.paint).toEqual({
      type: 'solid',
      color: fromHex('#1a1a1a').color,
      opacity: 0.5,
      visible: false,
    })
  })
})

describe('the code node on disk', () => {
  function withCode() {
    const document = new SceneDocument()
    const code = document.insert(
      createCode({
        name: 'Nav',
        transform: translation(20, 30),
        size: { width: 200, height: 100 },
        source: 'export default function App() { return null }',
        props: { items: ['a', 'b'], depth: { level: 2 } },
      }),
    )
    // What a run leaves behind: a locked child carrying its source key.
    document.insert(
      createRectangle({ name: 'Generated', locked: true, sourceKey: 'root' }),
      code.id,
    )
    return { document, code }
  }

  it('writes the source and props and none of the generated children', () => {
    const { document, code } = withCode()
    const file = serializeDocument(document)

    const saved = file.nodes.find((node) => node.id === code.id)
    expect(saved?.type).toBe('code')
    if (saved?.type !== 'code') throw new Error('expected a code node')
    expect(saved.source).toContain('export default')
    expect(saved.props).toEqual({ items: ['a', 'b'], depth: { level: 2 } })
    // The child is gone and the code node does not reference it, so every id resolves.
    expect(file.nodes.some((node) => node.name === 'Generated')).toBe(false)
    expect(saved.children).toEqual([])
    expect(JSON.stringify(file)).not.toContain('sourceKey')
  })

  it('round trips through JSON with the source intact and no children', () => {
    const { document, code } = withCode()
    const parsed = parseDocument(JSON.parse(JSON.stringify(serializeDocument(document))))
    const restored = new SceneDocument()
    restored.load(parsed.root, parsed.nodes)

    const back = restored.expectNode(code.id)
    expect(back.type).toBe('code')
    if (back.type !== 'code') throw new Error('expected a code node')
    expect(back.source).toBe('export default function App() { return null }')
    expect(restored.getChildren(code.id)).toHaveLength(0)
  })

  it('strips generated children from the clipboard too, so a paste cannot carry ghosts', () => {
    const { document, code } = withCode()
    const subtree = serializeSubtree(document, [code.id])
    expect(subtree.nodes).toHaveLength(1)
    expect(subtree.nodes[0]?.children).toEqual([])
  })

  it('refuses a code node claiming a version before 6, like the autoWidth gate', () => {
    const { document } = withCode()
    const file = JSON.parse(JSON.stringify(serializeDocument(document))) as {
      version: number
    }
    file.version = 5
    expect(() => parseDocument(file)).toThrow(/"code" is not valid before version 6/)
  })

  it('names the path of a prop that is not JSON', () => {
    const { document } = withCode()
    const file = JSON.parse(JSON.stringify(serializeDocument(document))) as {
      nodes: { type: string; props?: Record<string, unknown> }[]
    }
    const saved = file.nodes.find((node) => node.type === 'code')
    if (saved) saved.props = { bad: Number.NaN }
    expect(() => parseDocument(file)).toThrow(/props\.bad is not a finite number/)
  })
})
