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
