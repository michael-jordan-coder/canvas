import type { SceneDocument } from './document.js'
import type { Mat2D, Size, Vec2 } from './math.js'
import {
  cloneNode,
  cloneNodeAs,
  createNodeId,
  type NodeId,
  type NodeType,
  type SceneNode,
} from './node.js'
import type { Paint, RGBA, Stroke, StrokeAlign } from './paint.js'

/**
 * Bump when the on disk shape changes in a way older data cannot satisfy. Saved documents
 * carry it so a future version can migrate rather than guess.
 */
export const SCHEMA_VERSION = 1

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

function parsePaint(value: unknown, path: string): Paint {
  const p = requireRecord(value, path)
  const type = requireString(p['type'], `${path}.type`)
  if (type !== 'solid') throw new InvalidDocumentError(`${path}.type "${type}" is not supported`)
  return { type: 'solid', color: parseColor(p['color'], `${path}.color`) }
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

const NODE_TYPES: readonly string[] = ['page', 'frame', 'rectangle', 'ellipse']

function parseNode(value: unknown, path: string): SceneNode {
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
  }

  switch (type as NodeType) {
    case 'page':
      return { ...shared, type: 'page' }
    case 'frame':
      return {
        ...shared,
        type: 'frame',
        clipsContent: requireBoolean(n['clipsContent'], `${path}.clipsContent`),
        cornerRadius: requireNumber(n['cornerRadius'], `${path}.cornerRadius`),
        fills: parsePaints(n['fills'], `${path}.fills`),
        strokes: parseStrokes(n['strokes'], `${path}.strokes`),
      }
    case 'rectangle':
      return {
        ...shared,
        type: 'rectangle',
        cornerRadius: requireNumber(n['cornerRadius'], `${path}.cornerRadius`),
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
  const nodes = requireArray(data['nodes'], 'nodes').map((node, index) =>
    parseNode(node, `nodes[${index}]`),
  )
  const root = requireNodeId(data['root'], 'root')
  if (!nodes.some((node) => node.id === root)) {
    throw new InvalidDocumentError('root does not name a node in the file')
  }
  return { kind: 'figma-canvas/document', version: parseVersion(data['version']), root, nodes }
}

export function parseSubtree(value: unknown): SerializedSubtree {
  const data = requireRecord(value, 'subtree')
  if (data['kind'] !== 'figma-canvas/subtree') {
    throw new InvalidDocumentError('Not a figma-canvas subtree')
  }
  return {
    kind: 'figma-canvas/subtree',
    version: parseVersion(data['version']),
    roots: requireArray(data['roots'], 'roots').map((id, index) =>
      requireNodeId(id, `roots[${index}]`),
    ),
    nodes: requireArray(data['nodes'], 'nodes').map((node, index) =>
      parseNode(node, `nodes[${index}]`),
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
