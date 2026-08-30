import { IDENTITY, type Mat2D, type Size } from './math.js'
import type { DropShadow, Paint, RGBA, Stroke } from './paint.js'
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

export type NodeType = 'page' | 'frame' | 'rectangle' | 'ellipse' | 'text' | 'code'

/**
 * A value that survives JSON, structured clone and the save file unchanged. Code node props
 * are constrained to this so the same record can ride the worker boundary, the clipboard and
 * the document format without a serializer per surface.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

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
  /**
   * The element key path this node was generated from, present only on nodes a code node's
   * run produced. It is what lets a re-run recognise its own output and update in place
   * instead of replacing it, so ids stay stable where keys match. Never serialized: generated
   * nodes are skipped on save entirely.
   */
  sourceKey?: string
}

/**
 * What an absent `PageNode.backgroundColor` means. One constant, because three consumers
 * have to agree on it: the renderer clears to it, the properties panel shows it as the
 * swatch for an uncoloured page, and "back to the default" is written against it.
 */
export const DEFAULT_PAGE_BACKGROUND: RGBA = { r: 138 / 255, g: 138 / 255, b: 138 / 255, a: 1 }

export interface PageNode extends BaseNode {
  readonly type: 'page'
  /**
   * What the canvas clears to behind everything drawn. Absent means the default backdrop,
   * so old files need no field and no schema version. Alpha is carried but drawn as 1:
   * the surface is opaque and there is nothing behind the page to blend with.
   */
  backgroundColor?: RGBA
}

export interface FrameNode extends BaseNode {
  readonly type: 'frame'
  clipsContent: boolean
  fills: Paint[]
  strokes: Stroke[]
  /** As typed, not as drawn. What is drawn is `resolveCornerRadii` against the size. */
  cornerRadii: CornerRadii
  /**
   * Drop shadows, topmost first the way `fills` is. Optional with absence meaning none, so
   * a file from before effects and a node that simply has none read identically. A list
   * rather than a single field because a second shadow later is then not a schema change.
   * Text deliberately has no `effects`: a glyph's coverage comes from the atlas rather than
   * the box SDF, so a text shadow is a different feature, out of scope for this pass.
   */
  effects?: DropShadow[]
  layout?: FrameLayout
}

export interface RectangleNode extends BaseNode {
  readonly type: 'rectangle'
  fills: Paint[]
  strokes: Stroke[]
  /** As typed, not as drawn. What is drawn is `resolveCornerRadii` against the size. */
  cornerRadii: CornerRadii
  effects?: DropShadow[]
}

export interface EllipseNode extends BaseNode {
  readonly type: 'ellipse'
  fills: Paint[]
  strokes: Stroke[]
  effects?: DropShadow[]
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
 * A frame whose children are written by running `source` rather than by hand. The code is
 * the truth: the children it generates are real nodes in the document, created `locked` and
 * carrying `sourceKey`, and only `source` and `props` are saved. `size` is a cache of the
 * generated tree's bounds, under the text node's rule: whatever writes the source writes the
 * size in the same transaction.
 */
export interface CodeNode extends BaseNode {
  readonly type: 'code'
  source: string
  /** Handed to the code's default export on every run. JSON-safe so it saves and clones. */
  props: Record<string, JsonValue>
  clipsContent: boolean
  fills: Paint[]
  strokes: Stroke[]
  /** As typed, not as drawn. What is drawn is `resolveCornerRadii` against the size. */
  cornerRadii: CornerRadii
}

export type SceneNode = PageNode | FrameNode | RectangleNode | EllipseNode | TextNode | CodeNode

/** Nodes that paint something. Excludes the page, which is only a container. */
export type PaintedNode = FrameNode | RectangleNode | EllipseNode | TextNode | CodeNode

export function isPainted(node: SceneNode): node is PaintedNode {
  return node.type !== 'page'
}

export function canHaveChildren(node: SceneNode): boolean {
  return node.type === 'page' || node.type === 'frame' || node.type === 'code'
}

/**
 * Whether the user may put children here by hand: drawing inside, dropping a layer row,
 * pasting into. A code node holds children but owns them, so it answers no. Split from
 * `canHaveChildren` because the document-level insert has to accept generated children while
 * every user-facing path refuses them.
 */
export function acceptsManualChildren(node: SceneNode): boolean {
  return node.type === 'page' || node.type === 'frame'
}

/**
 * Whether this node clips its children to its own geometry. One predicate because three
 * consumers have to agree on it: the clip chain the shader walks, hit testing, and the
 * marquee's visibility rect. A site asking `type === 'frame'` by hand would silently leave
 * the code node out of one of them.
 */
export function clipsChildren(node: SceneNode): node is FrameNode | CodeNode {
  return (node.type === 'frame' || node.type === 'code') && node.clipsContent
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

export function createCode(init: Partial<Omit<CodeNode, 'id' | 'type'>> = {}): CodeNode {
  return {
    ...base('code', 'Code'),
    type: 'code',
    source: '',
    props: {},
    clipsContent: true,
    fills: [],
    strokes: [],
    cornerRadii: uniformCornerRadii(),
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
    case 'linear':
    case 'radial':
      // The stops get their own array and each stop its own colour. Sharing either would
      // have history and autosave mutating each other's state, which is the exact bug this
      // switch exists to prevent.
      return {
        ...paint,
        from: { ...paint.from },
        to: { ...paint.to },
        stops: paint.stops.map((stop) => ({ position: stop.position, color: { ...stop.color } })),
      }
  }
}

function cloneStroke(stroke: Stroke): Stroke {
  return { paint: clonePaint(stroke.paint), weight: stroke.weight, align: stroke.align }
}

function cloneEffect(effect: DropShadow): DropShadow {
  return { ...effect, offset: { ...effect.offset }, color: { ...effect.color } }
}

/** Conditional for the same reason `layoutChild` is: absence has to survive the clone. */
function cloneEffects(effects: DropShadow[] | undefined): { effects?: DropShadow[] } {
  return effects ? { effects: effects.map(cloneEffect) } : {}
}

/**
 * Hand-rolled rather than `structuredClone`, which this package's ES-only lib deliberately
 * does not know about: reaching for a host global here is the boundary being crossed.
 */
export function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (value !== null && typeof value === 'object') {
    const copy: { [key: string]: JsonValue } = {}
    for (const [key, entry] of Object.entries(value)) copy[key] = cloneJsonValue(entry)
    return copy
  }
  return value
}

function cloneProps(props: Record<string, JsonValue>): Record<string, JsonValue> {
  const copy: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(props)) copy[key] = cloneJsonValue(value)
  return copy
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
    ...(node.sourceKey !== undefined ? { sourceKey: node.sourceKey } : {}),
  }

  switch (node.type) {
    case 'page':
      return {
        ...shared,
        id,
        type: 'page',
        ...(node.backgroundColor ? { backgroundColor: { ...node.backgroundColor } } : {}),
      }
    case 'frame':
      return {
        ...shared,
        id,
        type: 'frame',
        clipsContent: node.clipsContent,
        cornerRadii: { ...node.cornerRadii },
        fills: node.fills.map(clonePaint),
        strokes: node.strokes.map(cloneStroke),
        ...cloneEffects(node.effects),
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
        ...cloneEffects(node.effects),
      }
    case 'ellipse':
      return {
        ...shared,
        id,
        type: 'ellipse',
        fills: node.fills.map(clonePaint),
        strokes: node.strokes.map(cloneStroke),
        ...cloneEffects(node.effects),
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
    case 'code':
      return {
        ...shared,
        id,
        type: 'code',
        source: node.source,
        props: cloneProps(node.props),
        clipsContent: node.clipsContent,
        cornerRadii: { ...node.cornerRadii },
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
