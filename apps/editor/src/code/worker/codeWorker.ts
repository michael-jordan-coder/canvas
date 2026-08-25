/// <reference lib="webworker" />
import type { JsonValue } from '@canvas/document'
import type { CodeWorkerRequest, CodeWorkerResponse } from '../protocol.js'
import { compileSource } from '../runtime/compile.js'
import {
  createSession,
  disposeSession,
  renderTree,
  type HandlerBag,
  type Session,
} from '../runtime/render.js'
import type { ComponentFn } from '../runtime/jsx.js'

/**
 * The thin shell around the pure runtime: sessions by node, compile cache by source, and
 * the postMessage traffic. Being a worker is the point, not a detail. User code that hangs
 * hangs this thread, and the editor answers with `terminate` and a fresh worker; on the
 * main thread the same loop would take the tab, the document and the last 600ms of unsaved
 * work with it.
 */

interface NodeSession {
  session: Session
  entry: ComponentFn | null
  compiledFrom: string | null
  props: Record<string, JsonValue>
  handlers: Map<string, HandlerBag>
  live: boolean
  rerenderQueued: boolean
}

/**
 * Take the network away from this thread before a single line of user code compiles.
 *
 * The worker exists to run untrusted TypeScript, and left alone it can reach the network as
 * freely as the page: a code node could `fetch` a canvas out to a server, or open
 * `ws://localhost:5174` and drive the agent, which admits this origin. None of that is
 * anything a code node is meant to do, so the capabilities are removed rather than policed.
 *
 * The methods live on the WorkerGlobalScope prototype (the WindowOrWorkerGlobalScope mixin)
 * and the constructors on `self` itself, so shadowing `self.fetch` alone would leave the real
 * one reachable up the prototype chain. Each name is deleted wherever it sits on the chain and
 * then pinned to `undefined` as an own property, so a plain reference reads as missing and a
 * call throws. This runs once at module load, which is before any `run` message can arrive.
 */
function removeNetworkEgress(): void {
  const names = ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'importScripts']
  for (const name of names) {
    // The chain walk needs to index arbitrary names off each prototype; `unknown`-valued record
    // is the honest type for "a global object whose members we are erasing".
    let level: object | null = self as object
    while (level) {
      if (Object.prototype.hasOwnProperty.call(level, name)) {
        try {
          delete (level as Record<string, unknown>)[name]
        } catch {
          // A non-configurable slot in some engine: the own-property shadow below still hides it.
        }
      }
      level = Object.getPrototypeOf(level) as object | null
    }
    ;(self as unknown as Record<string, unknown>)[name] = undefined
  }
}

removeNetworkEgress()

const sessions = new Map<string, NodeSession>()

function post(message: CodeWorkerResponse): void {
  self.postMessage(message)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sessionFor(nodeId: string): NodeSession {
  const existing = sessions.get(nodeId)
  if (existing) return existing
  const created: NodeSession = {
    session: createSession(() => scheduleRerender(nodeId)),
    entry: null,
    compiledFrom: null,
    props: {},
    handlers: new Map(),
    live: false,
    rerenderQueued: false,
  }
  sessions.set(nodeId, created)
  return created
}

/**
 * Coalesced to a microtask, so a handler that calls three setters renders once. The editor
 * ignores updates outside play mode, but the gate here matters too: a static session must
 * not schedule at all, or a stray timer would keep a disposed prototype rendering forever.
 */
function scheduleRerender(nodeId: string): void {
  const node = sessions.get(nodeId)
  if (!node || !node.live || node.rerenderQueued) return
  node.rerenderQueued = true
  queueMicrotask(() => {
    node.rerenderQueued = false
    if (!node.entry || !node.live) return
    try {
      const result = renderTree(node.entry, node.props, node.session)
      node.handlers = result.handlers
      post({ type: 'update', nodeId, tree: result.roots })
      for (const task of result.effects) task.run()
    } catch (error) {
      post({ type: 'update-error', nodeId, error: message(error) })
    }
  })
}

function run(request: Extract<CodeWorkerRequest, { type: 'run' }>): void {
  let node = sessionFor(request.nodeId)
  if (request.fresh) {
    disposeSession(node.session)
    sessions.delete(request.nodeId)
    node = sessionFor(request.nodeId)
  }
  node.props = request.props
  node.live = request.mode === 'live'

  try {
    if (node.compiledFrom !== request.source) {
      node.entry = compileSource(request.source)
      node.compiledFrom = request.source
    }
    if (!node.entry) throw new Error('nothing compiled')
    const result = renderTree(node.entry, node.props, node.session)
    node.handlers = result.handlers
    post({ type: 'result', id: request.id, nodeId: request.nodeId, ok: true, tree: result.roots })
    if (node.live) for (const task of result.effects) task.run()
  } catch (error) {
    post({ type: 'result', id: request.id, nodeId: request.nodeId, ok: false, error: message(error) })
  }
}

function dispatch(request: Extract<CodeWorkerRequest, { type: 'event' }>): void {
  const node = sessions.get(request.nodeId)
  if (!node || !node.live) return
  // Bubbling is a walk up the key path: an element's ancestors are its id's prefixes.
  let path: string | null = request.elementId
  while (path !== null) {
    const handler = node.handlers.get(path)?.[request.kind]
    if (handler) {
      try {
        handler({ x: request.point.x, y: request.point.y })
      } catch (error) {
        post({ type: 'update-error', nodeId: request.nodeId, error: message(error) })
      }
      return
    }
    const cut = path.lastIndexOf('/')
    path = cut === -1 ? null : path.slice(0, cut)
  }
}

self.onmessage = (event: MessageEvent<CodeWorkerRequest>) => {
  const request = event.data
  switch (request.type) {
    case 'run':
      run(request)
      break
    case 'event':
      dispatch(request)
      break
    case 'dispose': {
      const node = sessions.get(request.nodeId)
      if (node) {
        disposeSession(node.session)
        sessions.delete(request.nodeId)
      }
      break
    }
  }
}
