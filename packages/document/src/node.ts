import { IDENTITY, type Mat2D, type Size } from './math.js'
import type { Paint, Stroke } from './paint.js'
import { uniformCornerRadii, type CornerRadii } from './sdf.js'

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

export type NodeType = 'page' | 'frame' | 'rectangle' | 'ellipse' | 'text' | 'component'

export type LayoutDirection = 'horizontal' | 'vertical'
/** `space-between` is meaningful on the main axis only; the cross axis has no run to spread. */
export type LayoutAlign = 'start' | 'center' | 'end' | 'space-between'
export type AxisSizing = 'fixed' | 'hug'
export type ChildSizing = 'fixed' | 'fill'

export interface LayoutPadding {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Auto layout, as a setting on a frame. Present means the frame lays its children out in a
 * row or column; absent means children sit where their transforms say, which is how every
 * frame starts.
 *
 * `mainSizing`/`crossSizing` are the frame's own hug/fixed choice per axis. A hug axis is
 * measured from the children, so its `size` component becomes a cache in exactly the sense a
 * text node's is: whatever changes the children writes the frame size in the same
 * transaction.
 */
export interface FrameLayout {
  direction: LayoutDirection
  /** Between children, along the direction. Never negative. */
  gap: number
  padding: LayoutPadding
  mainAlign: LayoutAlign
  crossAlign: LayoutAlign
  mainSizing: AxisSizing
  crossSizing: AxisSizing
}

/**
 * How a node behaves inside an auto layout parent. Absent means fixed on both axes.
 *
 * Stored per node axis (width/height) rather than per parent axis (main/cross), so flipping
 * the parent's direction does not silently change which dimension stretches. Ignored when the
 * parent is not an auto layout frame, and deliberately not cleared on reparent: a node
 * dragged out and back keeps its intent.
 */
export interface LayoutChild {
  widthMode: ChildSizing
  heightMode: ChildSizing
}

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
  layoutChild?: LayoutChild
}

export interface PageNode extends BaseNode {
  readonly type: 'page'
}

export interface FrameNode extends BaseNode {
  readonly type: 'frame'
  clipsContent: boolean
  fills: Paint[]
  strokes: Stroke[]
  /** As typed, not as drawn. What is drawn is `resolveCornerRadii` against the size. */
  cornerRadii: CornerRadii
  layout?: FrameLayout
}

export interface RectangleNode extends BaseNode {
  readonly type: 'rectangle'
  fills: Paint[]
  strokes: Stroke[]
  /** As typed, not as drawn. What is drawn is `resolveCornerRadii` against the size. */
  cornerRadii: CornerRadii
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

/**
 * A value a component prop can hold.
 *
 * Deliberately the three JSON scalars and nothing else. The document is serialized, undone
 * and redone by cloning, so a prop that held a function or a React element would be a
 * reference the history could not copy and the save format could not write. Anything richer
 * belongs in the registry, which is where the React side of a component lives.
 */
export type ComponentPropValue = string | number | boolean

/**
 * An instance of a real React component, as far as the scene model is concerned.
 *
 * `component` is a registry key and `props` is a bag of scalars, and that is the whole of
 * what this package knows: it has no DOM and no React, so it cannot hold a component type
 * and must not try. The editor's registry turns the key into something React can mount, and
 * the DOM layer mounts it. Nothing here or in the renderer ever draws one, which is the
 * point: a component node contributes no instances to the shape buffer, so what you see is
 * the React component itself rather than a canvas impression of it.
 *
 * It carries no fills or strokes for the same reason. What it looks like is the component's
 * business, and offering paint here would be offering a setting nothing reads.
 */
export interface ComponentNode extends BaseNode {
  readonly type: 'component'
  /** Key into the editor's component registry. Unknown keys load and render a placeholder. */
  component: string
  props: Record<string, ComponentPropValue>
  /**
   * True while `size` is the measured size of what the component renders, which is how a
   * node starts. Dragging a resize handle turns it off, exactly as it turns off a text
   * node's `autoWidth`, and from then on the box is the setting and the component fills it.
   */
  autoSize: boolean
}

export type SceneNode =
  | PageNode
  | FrameNode
  | RectangleNode
  | EllipseNode
  | TextNode
  | ComponentNode

/** Nodes that paint something on the GPU. Excludes the page and every component instance. */
export type PaintedNode = FrameNode | RectangleNode | EllipseNode | TextNode

/**
 * Nodes that occupy a box: everything except the page, which is a container with no extent
 * of its own.
 *
 * Separate from `isPainted` because a component node has bounds without having paint. Hit
 * testing, the selection box and auto layout all ask about the box; only the packer asks
 * about the paint.
 */
export type BoxedNode = Exclude<SceneNode, PageNode>

export function isPainted(node: SceneNode): node is PaintedNode {
  return node.type !== 'page' && node.type !== 'component'
}

export function hasBounds(node: SceneNode): node is BoxedNode {
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
    cornerRadii: uniformCornerRadii(),
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
    cornerRadii: uniformCornerRadii(),
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

/**
 * A component instance. `size` is filled in by whoever creates it, from the measurement of
 * what the component actually renders, in the same transaction: `size` is a cache of the
 * render exactly as a text node's is a cache of its text.
 */
export function createComponent(
  init: Partial<Omit<ComponentNode, 'id' | 'type'>> = {},
): ComponentNode {
  return {
    ...base('component', 'Component'),
    type: 'component',
    component: '',
    props: {},
    autoSize: true,
    ...init,
  }
}

/** The layout a frame gets when auto layout is switched on with nothing to infer from. */
export function defaultFrameLayout(direction: LayoutDirection = 'horizontal'): FrameLayout {
  return {
    direction,
    gap: 10,
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
    mainAlign: 'start',
    crossAlign: 'start',
    mainSizing: 'fixed',
    crossSizing: 'fixed',
  }
}

/**
 * Every field of whatever it is handed, not a solid rebuilt from a colour.
 *
 * This sits on the history path and, through `serializeDocument`, on the autosave path, so
 * anything it drops vanishes 600ms after the last edit with nothing the user did to explain
 * it. Switched on the kind rather than spread generically for the same reason `cloneNodeAs`
 * is: a paint kind added later stops compiling here instead of being quietly flattened into
 * a solid. Inside a case the spread is safe, since the type is narrowed to exactly the
 * fields being copied, and it is what keeps an absent optional absent.
 */
function clonePaint(paint: Paint): Paint {
  switch (paint.type) {
    case 'solid':
      return { ...paint, color: { ...paint.color } }
  }
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
    // Spread conditionally so a node without the field clones without the key, keeping the
    // clone indistinguishable from the original.
    ...(node.layoutChild ? { layoutChild: { ...node.layoutChild } } : {}),
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
        cornerRadii: { ...node.cornerRadii },
        fills: node.fills.map(clonePaint),
        strokes: node.strokes.map(cloneStroke),
        ...(node.layout
          ? { layout: { ...node.layout, padding: { ...node.layout.padding } } }
          : {}),
      }
    case 'rectangle':
      return {
        ...shared,
        id,
        type: 'rectangle',
        cornerRadii: { ...node.cornerRadii },
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
    case 'component':
      return {
        ...shared,
        id,
        type: 'component',
        component: node.component,
        // Copied rather than shared, for the same reason `children` is: history hands these
        // clones back to the live document, and a shared bag would let the next prop edit
        // rewrite the step that came before it.
        props: { ...node.props },
        autoSize: node.autoSize,
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
