import type { SceneDocument } from './document.js'
import type { Mat2D, Size, Vec2 } from './math.js'
import {
  cloneNode,
  cloneNodeAs,
  createNodeId,
  type AxisSizing,
  type ChildSizing,
  type ComponentPropValue,
  type FrameLayout,
  type LayoutAlign,
  type LayoutChild,
  type LayoutDirection,
  type NodeId,
  type NodeType,
  type SceneNode,
} from './node.js'
import type { Paint, RGBA, Stroke, StrokeAlign } from './paint.js'
import { uniformCornerRadii, type CornerRadii } from './sdf.js'

/**
 * Bump when the on disk shape changes in a way older data cannot satisfy. Saved documents
 * carry it so a future version can migrate rather than guess.
 *
 * 2 added the text node. Nothing needs migrating in that direction, since a version 1 file
 * cannot contain one and every field it does have is unchanged. The bump earns its keep in
 * the other direction: a build from before text opens a version 2 file and says so, instead
 * of failing halfway through on `nodes[7].type "text" is not a node type`.
 *
 * 3 added `autoWidth` to the text node, and is the first version that does need migrating:
 * every text node in a version 2 file predates fixed width boxes, so it was auto width.
 * That is why `parseNode` is told the version rather than defaulting the field whatever it
 * reads. Filling a gap silently is how a file that is actually malformed gets through.
 *
 * 4 added auto layout: `layout` on frames and `layoutChild` on every node. Both are optional
 * in the model with absence meaning "not participating", so an older file needs no
 * migration; an absent field and a version 3 file mean the same thing. The bump is for the
 * other direction again, so a build from before auto layout refuses a version 4 file instead
 * of silently dropping the layout and then overwriting the save without it.
 *
 * 5 replaced the scalar `cornerRadius` on frames and rectangles with the four `cornerRadii`.
 * A version 4 file has one number that applied to every corner, which is exactly four equal
 * radii, so the migration is total rather than a guess. Like `autoWidth` it is version gated
 * rather than defaulted from whichever field happens to be present, since reading either
 * shape at either version would let a genuinely malformed file through.
 *
 * Per-paint `opacity` and `visible` arrived after 5 and deliberately did not bump it. Both
 * are optional in the model with absence meaning the default, so a paint written before
 * they existed and one that simply has neither are the same paint, which is what makes the
 * gate unnecessary in both directions.
 *
 * 6 added the component node, which is the text node's situation exactly: a version 5 file
 * cannot contain one and every field it does have is unchanged, so nothing migrates in that
 * direction. The bump earns its keep in the other one, where a build from before components
 * refuses a version 6 file by version rather than failing on
 * `nodes[4].type "component" is not a node type` halfway through a load.
 */
export const SCHEMA_VERSION = 6

export interface SerializedDocument {
  kind: 'figma-canvas/document'
  version: number
  root: NodeId
  /** Flat. Structure lives in each node's `children`, so order here does not matter. */
  nodes: SceneNode[]
}

export interface SerializedSubtree {
  kind: 'figma-canvas/subtree'
  version: number
  roots: NodeId[]
  nodes: SceneNode[]
}

export class InvalidDocumentError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'InvalidDocumentError'
  }
}

// Reading ---------------------------------------------------------------------------------

/*
 * Hand written rather than a schema library, because this is the only untrusted input the
 * app has and adding a dependency for one file is a poor trade. Every failure names the path
 * that failed, so a corrupt save says which node and which field rather than "invalid".
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidDocumentError(`${path} is not an object`)
  return value
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidDocumentError(`${path} is not a finite number`)
  }
  return value
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new InvalidDocumentError(`${path} is not a string`)
  return value
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new InvalidDocumentError(`${path} is not a boolean`)
  return value
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidDocumentError(`${path} is not an array`)
  return value
}

function requireNodeId(value: unknown, path: string): NodeId {
  return requireString(value, path) as NodeId
}

function parseMatrix(value: unknown, path: string): Mat2D {
  const m = requireRecord(value, path)
  return {
    a: requireNumber(m['a'], `${path}.a`),
    b: requireNumber(m['b'], `${path}.b`),
    c: requireNumber(m['c'], `${path}.c`),
    d: requireNumber(m['d'], `${path}.d`),
    tx: requireNumber(m['tx'], `${path}.tx`),
    ty: requireNumber(m['ty'], `${path}.ty`),
  }
}

function parseSize(value: unknown, path: string): Size {
  const s = requireRecord(value, path)
  return {
    width: requireNumber(s['width'], `${path}.width`),
    height: requireNumber(s['height'], `${path}.height`),
  }
}

function parseColor(value: unknown, path: string): RGBA {
  const c = requireRecord(value, path)
  return {
    r: requireNumber(c['r'], `${path}.r`),
    g: requireNumber(c['g'], `${path}.g`),
    b: requireNumber(c['b'], `${path}.b`),
    a: requireNumber(c['a'], `${path}.a`),
  }
}

/**
 * `opacity` and `visible` are absent-means-default in the model itself, so a version 5 file
 * that predates them and a paint that simply carries neither read identically and no version
 * gate is needed. Present but wrong is still an error, and still names its own path.
 */
function parsePaint(value: unknown, path: string): Paint {
  const p = requireRecord(value, path)
  const type = requireString(p['type'], `${path}.type`)
  if (type !== 'solid') throw new InvalidDocumentError(`${path}.type "${type}" is not supported`)
  return {
    type: 'solid',
    color: parseColor(p['color'], `${path}.color`),
    ...(p['opacity'] !== undefined
      ? { opacity: requireNumber(p['opacity'], `${path}.opacity`) }
      : {}),
    ...(p['visible'] !== undefined
      ? { visible: requireBoolean(p['visible'], `${path}.visible`) }
      : {}),
  }
}

/**
 * Before 5 a corner radius was one number for all four corners, so a version 4 file is read
 * through its old field and widened. Nothing is lost either way, which is what makes this a
 * migration rather than a default.
 */
function parseCornerRadii(
  node: Record<string, unknown>,
  path: string,
  version: number,
): CornerRadii {
  if (version < 5) {
    return uniformCornerRadii(requireNumber(node['cornerRadius'], `${path}.cornerRadius`))
  }
  const r = requireRecord(node['cornerRadii'], `${path}.cornerRadii`)
  return {
    topLeft: requireNumber(r['topLeft'], `${path}.cornerRadii.topLeft`),
    topRight: requireNumber(r['topRight'], `${path}.cornerRadii.topRight`),
    bottomRight: requireNumber(r['bottomRight'], `${path}.cornerRadii.bottomRight`),
    bottomLeft: requireNumber(r['bottomLeft'], `${path}.cornerRadii.bottomLeft`),
  }
}

function parsePaints(value: unknown, path: string): Paint[] {
  return requireArray(value, path).map((paint, index) => parsePaint(paint, `${path}[${index}]`))
}

const STROKE_ALIGNS: readonly string[] = ['inside', 'outside', 'center']

function parseStroke(value: unknown, path: string): Stroke {
  const s = requireRecord(value, path)
  const align = requireString(s['align'], `${path}.align`)
  if (!STROKE_ALIGNS.includes(align)) {
    throw new InvalidDocumentError(`${path}.align "${align}" is not a stroke alignment`)
  }
  return {
    paint: parsePaint(s['paint'], `${path}.paint`),
    weight: requireNumber(s['weight'], `${path}.weight`),
    align: align as StrokeAlign,
  }
}

function parseStrokes(value: unknown, path: string): Stroke[] {
  return requireArray(value, path).map((stroke, index) => parseStroke(stroke, `${path}[${index}]`))
}

const LAYOUT_DIRECTIONS: readonly string[] = ['horizontal', 'vertical']
const LAYOUT_ALIGNS: readonly string[] = ['start', 'center', 'end', 'space-between']
const AXIS_SIZINGS: readonly string[] = ['fixed', 'hug']
const CHILD_SIZINGS: readonly string[] = ['fixed', 'fill']

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly string[],
  path: string,
  what: string,
): T {
  const text = requireString(value, path)
  if (!allowed.includes(text)) {
    throw new InvalidDocumentError(`${path} "${text}" is not ${what}`)
  }
  return text as T
}

function parseFrameLayout(value: unknown, path: string): FrameLayout {
  const l = requireRecord(value, path)
  const p = requireRecord(l['padding'], `${path}.padding`)
  return {
    direction: requireOneOf<LayoutDirection>(
      l['direction'], LAYOUT_DIRECTIONS, `${path}.direction`, 'a layout direction',
    ),
    gap: requireNumber(l['gap'], `${path}.gap`),
    padding: {
      top: requireNumber(p['top'], `${path}.padding.top`),
      right: requireNumber(p['right'], `${path}.padding.right`),
      bottom: requireNumber(p['bottom'], `${path}.padding.bottom`),
      left: requireNumber(p['left'], `${path}.padding.left`),
    },
    mainAlign: requireOneOf<LayoutAlign>(
      l['mainAlign'], LAYOUT_ALIGNS, `${path}.mainAlign`, 'an alignment',
    ),
    crossAlign: requireOneOf<LayoutAlign>(
      l['crossAlign'], LAYOUT_ALIGNS, `${path}.crossAlign`, 'an alignment',
    ),
    mainSizing: requireOneOf<AxisSizing>(
      l['mainSizing'], AXIS_SIZINGS, `${path}.mainSizing`, 'an axis sizing',
    ),
    crossSizing: requireOneOf<AxisSizing>(
      l['crossSizing'], AXIS_SIZINGS, `${path}.crossSizing`, 'an axis sizing',
    ),
  }
}

function parseLayoutChild(value: unknown, path: string): LayoutChild {
  const c = requireRecord(value, path)
  return {
    widthMode: requireOneOf<ChildSizing>(
      c['widthMode'], CHILD_SIZINGS, `${path}.widthMode`, 'a child sizing',
    ),
    heightMode: requireOneOf<ChildSizing>(
      c['heightMode'], CHILD_SIZINGS, `${path}.heightMode`, 'a child sizing',
    ),
  }
}

const NODE_TYPES: readonly string[] = [
  'page',
  'frame',
  'rectangle',
  'ellipse',
  'text',
  'component',
]

/**
 * A component's props, as the three JSON scalars the model allows and nothing else.
 *
 * Validated key by key rather than cast, like everything else in this file, because a saved
 * prop reaches a real React component: a nested object where a string was expected would be
 * handed straight to a component that has no reason to survive it. Nothing is dropped
 * silently, so a prop of the wrong shape names its own path.
 */
function parseComponentProps(value: unknown, path: string): Record<string, ComponentPropValue> {
  const raw = requireRecord(value, path)
  const props: Record<string, ComponentPropValue> = {}
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item === 'string' || typeof item === 'boolean') {
      props[key] = item
      continue
    }
    if (typeof item === 'number') {
      props[key] = requireNumber(item, `${path}.${key}`)
      continue
    }
    throw new InvalidDocumentError(`${path}.${key} is not a string, number or boolean`)
  }
  return props
}

function parseNode(value: unknown, path: string, version: number): SceneNode {
  const n = requireRecord(value, path)
  const type = requireString(n['type'], `${path}.type`)
  if (!NODE_TYPES.includes(type)) {
    throw new InvalidDocumentError(`${path}.type "${type}" is not a node type`)
  }

  const parentRaw = n['parent']
  const shared = {
    id: requireNodeId(n['id'], `${path}.id`),
    name: requireString(n['name'], `${path}.name`),
    visible: requireBoolean(n['visible'], `${path}.visible`),
    locked: requireBoolean(n['locked'], `${path}.locked`),
    opacity: requireNumber(n['opacity'], `${path}.opacity`),
    parent: parentRaw === null ? null : requireNodeId(parentRaw, `${path}.parent`),
    children: requireArray(n['children'], `${path}.children`).map((child, index) =>
      requireNodeId(child, `${path}.children[${index}]`),
    ),
    transform: parseMatrix(n['transform'], `${path}.transform`),
    size: parseSize(n['size'], `${path}.size`),
    // Absence means "no layout behaviour" in the model itself, so a version 3 file and a
    // node that simply has none read identically and no version check is needed.
    ...(n['layoutChild'] !== undefined
      ? { layoutChild: parseLayoutChild(n['layoutChild'], `${path}.layoutChild`) }
      : {}),
  }

  switch (type as NodeType) {
    case 'page':
      return { ...shared, type: 'page' }
    case 'frame':
      return {
        ...shared,
        type: 'frame',
        clipsContent: requireBoolean(n['clipsContent'], `${path}.clipsContent`),
        cornerRadii: parseCornerRadii(n, path, version),
        fills: parsePaints(n['fills'], `${path}.fills`),
        strokes: parseStrokes(n['strokes'], `${path}.strokes`),
        ...(n['layout'] !== undefined
          ? { layout: parseFrameLayout(n['layout'], `${path}.layout`) }
          : {}),
      }
    case 'rectangle':
      return {
        ...shared,
        type: 'rectangle',
        cornerRadii: parseCornerRadii(n, path, version),
        fills: parsePaints(n['fills'], `${path}.fills`),
        strokes: parseStrokes(n['strokes'], `${path}.strokes`),
      }
    case 'ellipse':
      return {
        ...shared,
        type: 'ellipse',
        fills: parsePaints(n['fills'], `${path}.fills`),
        strokes: parseStrokes(n['strokes'], `${path}.strokes`),
      }
    case 'text':
      return {
        ...shared,
        type: 'text',
        characters: requireString(n['characters'], `${path}.characters`),
        fontSize: requireNumber(n['fontSize'], `${path}.fontSize`),
        // Before 3 there were only auto width boxes, so an absent field is not a gap.
        autoWidth:
          version < 3 ? true : requireBoolean(n['autoWidth'], `${path}.autoWidth`),
        fills: parsePaints(n['fills'], `${path}.fills`),
        strokes: parseStrokes(n['strokes'], `${path}.strokes`),
      }
    case 'component':
      return {
        ...shared,
        type: 'component',
        // Deliberately not checked against the registry, which does not exist down here and
        // is a different question anyway: a file naming a component this build no longer
        // ships is a valid file the editor renders a placeholder for, not a corrupt one.
        component: requireString(n['component'], `${path}.component`),
        props: parseComponentProps(n['props'], `${path}.props`),
        autoSize: requireBoolean(n['autoSize'], `${path}.autoSize`),
      }
  }
}

function parseVersion(value: unknown): number {
  const version = requireNumber(value, 'version')
  if (version > SCHEMA_VERSION) {
    throw new InvalidDocumentError(
      `This file is version ${version} and this build understands up to ${SCHEMA_VERSION}`,
    )
  }
  return version
}

export function parseDocument(value: unknown): SerializedDocument {
  const data = requireRecord(value, 'document')
  if (data['kind'] !== 'figma-canvas/document') {
    throw new InvalidDocumentError('Not a figma-canvas document')
  }
  const version = parseVersion(data['version'])
  const nodes = requireArray(data['nodes'], 'nodes').map((node, index) =>
    parseNode(node, `nodes[${index}]`, version),
  )
  const root = requireNodeId(data['root'], 'root')
  if (!nodes.some((node) => node.id === root)) {
    throw new InvalidDocumentError('root does not name a node in the file')
  }
  return { kind: 'figma-canvas/document', version, root, nodes }
}

export function parseSubtree(value: unknown): SerializedSubtree {
  const data = requireRecord(value, 'subtree')
  if (data['kind'] !== 'figma-canvas/subtree') {
    throw new InvalidDocumentError('Not a figma-canvas subtree')
  }
  const version = parseVersion(data['version'])
  return {
    kind: 'figma-canvas/subtree',
    version,
    roots: requireArray(data['roots'], 'roots').map((id, index) =>
      requireNodeId(id, `roots[${index}]`),
    ),
    nodes: requireArray(data['nodes'], 'nodes').map((node, index) =>
      parseNode(node, `nodes[${index}]`, version),
    ),
  }
}

// Writing ---------------------------------------------------------------------------------

export function serializeDocument(document: SceneDocument): SerializedDocument {
  return {
    kind: 'figma-canvas/document',
    version: SCHEMA_VERSION,
    root: document.rootId,
    nodes: [...document.walk()].map(cloneNode),
  }
}

/**
 * The selected nodes and everything under them.
 *
 * A node whose ancestor is also selected is dropped, so copying a frame and one of its
 * children does not paste that child twice.
 */
export function serializeSubtree(
  document: SceneDocument,
  selection: readonly NodeId[],
): SerializedSubtree {
  const selected = new Set(selection)
  const hasSelectedAncestor = (id: NodeId): boolean => {
    let node = document.getNode(id)
    while (node?.parent) {
      if (selected.has(node.parent)) return true
      node = document.getNode(node.parent)
    }
    return false
  }

  const roots = selection.filter((id) => document.getNode(id) && !hasSelectedAncestor(id))
  const nodes: SceneNode[] = []
  for (const rootId of roots) {
    for (const node of document.walk(rootId)) nodes.push(cloneNode(node))
  }

  return { kind: 'figma-canvas/subtree', version: SCHEMA_VERSION, roots, nodes }
}

/**
 * Inserts a copied subtree under `parentId` with fresh ids, offset so it does not land
 * exactly on top of whatever it was copied from.
 *
 * Returns the new roots, which is what the caller selects.
 */
export function instantiateSubtree(
  document: SceneDocument,
  data: SerializedSubtree,
  parentId: NodeId,
  offset: Vec2,
): SceneNode[] {
  const source = new Map(data.nodes.map((node) => [node.id, node]))
  const freshIds = new Map<NodeId, NodeId>()
  for (const node of data.nodes) freshIds.set(node.id, createNodeId())

  const mapped = (id: NodeId): NodeId => {
    const next = freshIds.get(id)
    if (!next) throw new InvalidDocumentError(`Subtree refers to a node it does not contain: ${id}`)
    return next
  }

  const created: SceneNode[] = []

  const insert = (oldId: NodeId, newParentId: NodeId, isRoot: boolean): void => {
    const original = source.get(oldId)
    if (!original) return

    const clone = cloneNodeAs(original, mapped(oldId))
    const childIds = [...clone.children]
    // Cleared so `document.insert` rebuilds the array as the children go in, which keeps the
    // order right without trusting the ids in the copied data.
    clone.children = []
    clone.parent = null
    if (isRoot) {
      clone.transform = {
        ...clone.transform,
        tx: clone.transform.tx + offset.x,
        ty: clone.transform.ty + offset.y,
      }
    }

    document.insert(clone, newParentId)
    if (isRoot) created.push(clone)
    for (const childId of childIds) insert(childId, clone.id, false)
  }

  // One transaction, so a paste of any size is a single undo step.
  document.transact(() => {
    for (const rootId of data.roots) insert(rootId, parentId, true)
  })

  return created
}
