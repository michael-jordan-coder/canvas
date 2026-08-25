import type { CodeElement, CodeElementEvents } from '@canvas/document'
import {
  cleanupCells,
  enterComponent,
  exitComponent,
  type EffectTask,
  type HookCell,
} from './hooks.js'
import { __fragment, type ComponentFn, type VChild, type VElement } from './jsx.js'

/**
 * Runs a component tree to a flat `CodeElement` tree, React's render phase without its
 * reconciler: the whole tree re-renders and the diffing happens later, against the scene,
 * keyed by path. At this scale a full re-run is cheaper than the machinery that avoids it,
 * and the instantiator's idempotence makes an unchanged subtree free anyway.
 *
 * Everything here is deliberately free of the worker: no postMessage, no self, no timers.
 * The worker entry is a thin shell around this, which is what makes it testable in node.
 */

export class CodeRenderError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'CodeRenderError'
  }
}

export interface HandlerBag {
  click?: (event: PointerPayload) => void
  pointerDown?: (event: PointerPayload) => void
  pointerUp?: (event: PointerPayload) => void
  pointerEnter?: (event: PointerPayload) => void
  pointerLeave?: (event: PointerPayload) => void
}

/** What a handler receives: the pointer in the code node's own space. */
export interface PointerPayload {
  x: number
  y: number
}

/**
 * Hook state for one code node, owned by the caller so it outlives every render. Cells are
 * keyed by the component's path, which is why a keyed list item keeps its state when the
 * list reorders: its path moves with its key, exactly as its node id does.
 */
export interface Session {
  components: Map<string, { owner: ComponentFn; cells: HookCell[] }>
  requestRerender: () => void
}

export function createSession(requestRerender: () => void): Session {
  return { components: new Map(), requestRerender }
}

/** Tears a session down, running every effect cleanup it still holds. */
export function disposeSession(session: Session): void {
  for (const entry of session.components.values()) cleanupCells(entry.cells)
  session.components.clear()
}

export interface RenderResult {
  roots: CodeElement[]
  /** Element path to its live handlers. Never crosses the worker boundary. */
  handlers: Map<string, HandlerBag>
  /** To run after the tree has been posted, in order. */
  effects: EffectTask[]
}

const EVENT_PROPS: Record<string, keyof CodeElementEvents> = {
  onClick: 'click',
  onPointerDown: 'pointerDown',
  onPointerUp: 'pointerUp',
  onPointerEnter: 'pointerEnter',
  onPointerLeave: 'pointerLeave',
}

const PRIMITIVES = new Set(['frame', 'rectangle', 'ellipse', 'text'])

interface RenderState {
  session: Session
  visited: Set<string>
  /**
   * How many components have already expanded at each element path this render. A component
   * chain collapses onto one path on purpose, so the path alone cannot key hook state:
   * `App -> Wrap -> Frame` is two components at "root", each needing its own cells.
   */
  componentSeq: Map<string, number>
  handlers: Map<string, HandlerBag>
  effects: EffectTask[]
}

/** Flattens jsx children the way React does: arrays splice in, holes disappear. */
function flatten(children: readonly VChild[], out: (VElement | string | number)[]): void {
  for (const child of children) {
    if (child === null || child === undefined || typeof child === 'boolean') continue
    if (Array.isArray(child)) {
      flatten(child, out)
      continue
    }
    out.push(child)
  }
}

function isElement(value: VElement | string | number): value is VElement {
  return typeof value === 'object' && value.kind === 'element'
}

/**
 * Expands one jsx child into zero or more `CodeElement`s at `path`. A component expands in
 * place: its output takes the component's own path, so the component boundary is invisible
 * to reconciliation, exactly as a React component leaves no DOM node of its own.
 */
function expand(state: RenderState, child: VElement | string | number, path: string): CodeElement[] {
  if (!isElement(child)) {
    throw new CodeRenderError(
      `text "${String(child).slice(0, 40)}" can only appear inside <Text>`,
    )
  }

  if (child.type === __fragment) {
    return expandChildren(state, child.children, path)
  }

  if (typeof child.type === 'function') {
    return expandComponent(state, child, path)
  }

  if (!PRIMITIVES.has(child.type)) {
    throw new CodeRenderError(`<${child.type}> is not an element this canvas knows`)
  }
  return [buildElement(state, child, path)]
}

function expandComponent(state: RenderState, element: VElement, path: string): CodeElement[] {
  const fn = element.type as ComponentFn
  const seq = state.componentSeq.get(path) ?? 0
  state.componentSeq.set(path, seq + 1)
  const cellsKey = `${path}#${seq}`
  state.visited.add(cellsKey)

  let entry = state.session.components.get(cellsKey)
  // A different function at the same path is a different component, and its state with it.
  if (!entry || entry.owner !== fn) {
    if (entry) cleanupCells(entry.cells)
    entry = { owner: fn, cells: [] }
    state.session.components.set(cellsKey, entry)
  }

  enterComponent(entry.cells, state.effects, state.session.requestRerender)
  let output: VChild
  try {
    output = fn({ ...element.props, children: element.children })
  } finally {
    exitComponent()
  }

  const flat: (VElement | string | number)[] = []
  flatten([output], flat)
  // A single root keeps the component's own path; several fan out under it, keyed like any
  // other siblings so a keyed list at a component's root still reconciles by key.
  if (flat.length === 1 && flat[0] !== undefined) return expand(state, flat[0], path)
  return flat.flatMap((piece, index) =>
    expand(state, piece, childPath(path, piece, index)),
  )
}

/**
 * A path segment, with the separator escaped out of it. A key is the user's string and may
 * hold anything, `key={file.path}` included, and a raw slash in one would read back as a
 * level of nesting: bubbling walks a path by cutting at its last separator, so an element
 * keyed "docs/readme" would send its clicks to an ancestor that does not exist. Percent
 * encoding the two characters involved keeps every real separator the renderer's own.
 */
function escapeSegment(segment: string): string {
  return segment.replace(/%/g, '%25').replace(/\//g, '%2F')
}

function childPath(parent: string, child: VElement | string | number, index: number): string {
  const segment =
    isElement(child) && child.key !== undefined ? escapeSegment(child.key) : String(index)
  return parent === '' ? segment : `${parent}/${segment}`
}

function expandChildren(
  state: RenderState,
  children: readonly VChild[],
  parentPath: string,
): CodeElement[] {
  const flat: (VElement | string | number)[] = []
  flatten(children, flat)
  return flat.flatMap((child, index) =>
    expand(state, child, childPath(parentPath, child, index)),
  )
}

function buildElement(state: RenderState, element: VElement, path: string): CodeElement {
  const type = element.type as CodeElement['type']
  const props: Record<string, unknown> = {}
  const events: CodeElementEvents = {}
  const handlers: HandlerBag = {}
  let name: string | undefined

  for (const [propKey, value] of Object.entries(element.props)) {
    if (value === undefined) continue
    const event = EVENT_PROPS[propKey]
    if (event) {
      if (typeof value !== 'function') {
        throw new CodeRenderError(`${path}: ${propKey} is not a function`)
      }
      events[event] = true
      handlers[event] = value as (payload: PointerPayload) => void
      continue
    }
    if (propKey === 'name') {
      if (typeof value !== 'string') throw new CodeRenderError(`${path}: name is not a string`)
      name = value
      continue
    }
    // Everything else rides through as data. The main-thread validator is the authority on
    // what a prop may be; refusing here too would be a second copy of that list to drift.
    props[propKey] = value
  }

  const out: CodeElement = { type, id: path, props: props as CodeElement['props'] }
  if (element.key !== undefined) out.key = element.key
  if (name !== undefined) out.name = name
  if (Object.keys(events).length > 0) {
    out.events = events
    state.handlers.set(path, handlers)
  }

  if (type === 'text') {
    const flat: (VElement | string | number)[] = []
    flatten(element.children, flat)
    let text = ''
    for (const piece of flat) {
      if (isElement(piece)) {
        throw new CodeRenderError(`${path}: <Text> holds text, not elements`)
      }
      text += String(piece)
    }
    out.text = text
    return out
  }

  const children = expandChildren(state, element.children, path)
  if (children.length > 0) {
    if (type !== 'frame') {
      throw new CodeRenderError(`${path}: only <Frame> takes children`)
    }
    out.children = children
  }
  return out
}

/**
 * One full render: entry, with `props`, to the roots that become the code node's children.
 * Component paths not visited this time are dead; their cells are cleaned up and dropped,
 * the way React unmounts what a render no longer returns.
 */
export function renderTree(
  entry: ComponentFn,
  props: Record<string, unknown>,
  session: Session,
): RenderResult {
  const state: RenderState = {
    session,
    visited: new Set(),
    componentSeq: new Map(),
    handlers: new Map(),
    effects: [],
  }

  const rootElement: VElement = {
    kind: 'element',
    type: entry,
    key: undefined,
    props,
    children: [],
  }
  const roots = expand(state, rootElement, 'root')

  for (const [path, entryCells] of session.components) {
    if (!state.visited.has(path)) {
      cleanupCells(entryCells.cells)
      session.components.delete(path)
    }
  }

  return { roots, handlers: state.handlers, effects: state.effects }
}
