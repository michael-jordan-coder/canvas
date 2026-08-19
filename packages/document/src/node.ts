import { IDENTITY, type Mat2D, type Size } from './math.js'
import type { Paint, Stroke } from './paint.js'

/** Branded so a plain string cannot be passed where a node id is expected. */
export type NodeId = string & { readonly __nodeId: unique symbol }

let counter = 0

export function createNodeId(): NodeId {
  counter += 1
  return `n${counter}` as NodeId
}

/**
 * Pushes the id counter past everything in `ids`.
 *
 * Loading a saved file keeps its ids, so without this the next node created would collide
 * with one already in the document and silently overwrite it.
 */
export function reserveNodeIds(ids: Iterable<NodeId>): void {
  for (const id of ids) {
    const value = Number.parseInt(id.slice(1), 10)
    if (Number.isFinite(value) && value > counter) counter = value
  }
}

export type NodeType = 'page' | 'frame' | 'rectangle' | 'ellipse' | 'text'

export interface BaseNode {
  readonly id: NodeId
  readonly type: NodeType
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  parent: NodeId | null
  children: NodeId[]
  /** Local transform, relative to the parent. */
  transform: Mat2D
  size: Size
}

export interface PageNode extends BaseNode {
  readonly type: 'page'
}

export interface FrameNode extends BaseNode {
  readonly type: 'frame'
  clipsContent: boolean
  fills: Paint[]
  strokes: Stroke[]
  cornerRadius: number
}

export interface RectangleNode extends BaseNode {
  readonly type: 'rectangle'
  fills: Paint[]
  strokes: Stroke[]
  cornerRadius: number
}

export interface EllipseNode extends BaseNode {
  readonly type: 'ellipse'
  fills: Paint[]
  strokes: Stroke[]
}

/**
 * `size` is not set by hand the way it is on a shape: it is the measured bounds of the laid
 * out text, recomputed whenever `characters` or `fontSize` changes. It lives on the node
 * anyway because hit testing and the selection box need the bounds, and this package cannot
 * measure a string, having no DOM. Treat it as a cache with one rule: whatever writes the
 * text writes the size in the same transaction.
 */
export interface TextNode extends BaseNode {
  readonly type: 'text'
  characters: string
  /** In the same units as `size`, so a text node inside a scaled frame scales with it. */
  fontSize: number
  /**
   * True while the box sizes itself to its words, which is how a text node starts. Dragging a
   * resize handle turns it off, and from then on `size.width` is the width lines wrap to and
   * only the height is measured.
   */
  autoWidth: boolean
  fills: Paint[]
  strokes: Stroke[]
}

export type SceneNode = PageNode | FrameNode | RectangleNode | EllipseNode | TextNode

/** Nodes that paint something. Excludes the page, which is only a container. */
export type PaintedNode = FrameNode | RectangleNode | EllipseNode | TextNode

export function isPainted(node: SceneNode): node is PaintedNode {
  return node.type !== 'page'
}

export function canHaveChildren(node: SceneNode): boolean {
  return node.type === 'page' || node.type === 'frame'
}

const base = (type: NodeType, name: string): BaseNode => ({
  id: createNodeId(),
  type,
  name,
  visible: true,
  locked: false,
  opacity: 1,
  parent: null,
  children: [],
  transform: { ...IDENTITY },
  size: { width: 0, height: 0 },
})

export function createPage(name = 'Page 1'): PageNode {
  return { ...base('page', name), type: 'page' }
}

export function createFrame(init: Partial<Omit<FrameNode, 'id' | 'type'>> = {}): FrameNode {
  return {
    ...base('frame', 'Frame'),
    type: 'frame',
    clipsContent: true,
    fills: [],
    strokes: [],
    cornerRadius: 0,
    ...init,
  }
}

export function createRectangle(
  init: Partial<Omit<RectangleNode, 'id' | 'type'>> = {},
): RectangleNode {
  return {
    ...base('rectangle', 'Rectangle'),
    type: 'rectangle',
    fills: [],
    strokes: [],
    cornerRadius: 0,
    ...init,
  }
}

/** The default is a readable UI size rather than a display one, since most text here labels something. */
export const DEFAULT_FONT_SIZE = 16

export function createText(init: Partial<Omit<TextNode, 'id' | 'type'>> = {}): TextNode {
  return {
    ...base('text', 'Text'),
    type: 'text',
    characters: '',
    fontSize: DEFAULT_FONT_SIZE,
    autoWidth: true,
    fills: [],
    strokes: [],
    ...init,
  }
}

function clonePaint(paint: Paint): Paint {
  return { type: 'solid', color: { ...paint.color } }
}

function cloneStroke(stroke: Stroke): Stroke {
  return { paint: clonePaint(stroke.paint), weight: stroke.weight, align: stroke.align }
}

/**
 * A copy deep enough that nothing in it is shared with the original.
 *
 * History depends on this completely. If a clone kept a reference to the live `children`
 * array or to a paint, a later edit would reach back and quietly rewrite the past, and undo
 * would restore whatever the present happens to be.
 *
 * Written out per type rather than spread generically so the compiler checks that every
 * field of every node type is accounted for when a new one is added.
 */
export function cloneNode(node: SceneNode): SceneNode {
  return cloneNodeAs(node, node.id)
}

/**
 * Clone under a different id. Paste needs this: the same subtree cannot appear twice with
 * the same ids, and `id` is readonly precisely so it cannot be reassigned after the fact.
 */
export function cloneNodeAs(node: SceneNode, id: NodeId): SceneNode {
  const shared = {
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    parent: node.parent,
    children: [...node.children],
    transform: { ...node.transform },
    size: { ...node.size },
  }

  switch (node.type) {
    case 'page':
      return { ...shared, id, type: 'page' }
    case 'frame':
      return {
        ...shared,
        id,
        type: 'frame',
        clipsContent: node.clipsContent,
        cornerRadius: node.cornerRadius,
        fills: node.fills.map(clonePaint),
        strokes: node.strokes.map(cloneStroke),
      }
    case 'rectangle':
      return {
        ...shared,
        id,
        type: 'rectangle',
        cornerRadius: node.cornerRadius,
        fills: node.fills.map(clonePaint),
        strokes: node.strokes.map(cloneStroke),
      }
    case 'ellipse':
      return {
        ...shared,
        id,
        type: 'ellipse',
        fills: node.fills.map(clonePaint),
        strokes: node.strokes.map(cloneStroke),
      }
    case 'text':
      return {
        ...shared,
        id,
        type: 'text',
        characters: node.characters,
        fontSize: node.fontSize,
        autoWidth: node.autoWidth,
        fills: node.fills.map(clonePaint),
        strokes: node.strokes.map(cloneStroke),
      }
  }
}

export function createEllipse(init: Partial<Omit<EllipseNode, 'id' | 'type'>> = {}): EllipseNode {
  return {
    ...base('ellipse', 'Ellipse'),
    type: 'ellipse',
    fills: [],
    strokes: [],
    ...init,
  }
}
