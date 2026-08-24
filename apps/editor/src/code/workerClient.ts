import type { CodeElementEvents, JsonValue } from '@canvas/document'
import type { CodeWorkerRequest, CodeWorkerResponse, RunMode } from './protocol.js'

/**
 * The editor's handle on the code worker: request/response with ids and a timeout, the
 * same correlation shape the agent bridge uses for its WebSocket. The timeout is the whole
 * defense against `while (true)`: a worker that misses the deadline is terminated and
 * replaced, every pending run rejects with a message naming the likely loop, and the next
 * run gets a clean thread. Nothing is recovered from the dead worker on purpose; its hook
 * state was the loop's own state.
 */

/** Generous against compilation and honest against an infinite loop. */
const RUN_TIMEOUT_MS = 2000

interface Pending {
  resolve: (tree: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface CodeWorkerEvents {
  /** An unsolicited live-mode re-render. The tree is unvalidated. */
  onUpdate: (nodeId: string, tree: unknown) => void
  onUpdateError: (nodeId: string, error: string) => void
}

export class CodeWorkerClient {
  #worker: Worker | null = null
  #pending = new Map<number, Pending>()
  #nextId = 1
  #events: CodeWorkerEvents

  constructor(events: CodeWorkerEvents) {
    this.#events = events
  }

  #spawn(): Worker {
    if (this.#worker) return this.#worker
    const worker = new Worker(new URL('./worker/codeWorker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<CodeWorkerResponse>) => {
      const response = event.data
      if (response.type === 'update') {
        this.#events.onUpdate(response.nodeId, response.tree)
        return
      }
      if (response.type === 'update-error') {
        this.#events.onUpdateError(response.nodeId, response.error)
        return
      }
      const pending = this.#pending.get(response.id)
      if (!pending) return
      this.#pending.delete(response.id)
      clearTimeout(pending.timer)
      if (response.ok) pending.resolve(response.tree)
      else pending.reject(new Error(response.error))
    }
    this.#worker = worker
    return worker
  }

  #post(request: CodeWorkerRequest): void {
    this.#spawn().postMessage(request)
  }

  /** Runs the source and resolves the raw tree. The caller validates; this only transports. */
  run(
    nodeId: string,
    source: string,
    props: Record<string, JsonValue>,
    mode: RunMode,
    fresh: boolean,
  ): Promise<unknown> {
    const id = this.#nextId
    this.#nextId += 1
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        this.#restart()
        reject(
          new Error(`The code did not finish within ${RUN_TIMEOUT_MS / 1000}s, likely an infinite loop.`),
        )
      }, RUN_TIMEOUT_MS)
      this.#pending.set(id, { resolve, reject, timer })
      this.#post({ type: 'run', id, nodeId, source, props, mode, fresh })
    })
  }

  event(
    nodeId: string,
    elementId: string,
    kind: keyof CodeElementEvents,
    point: { x: number; y: number },
  ): void {
    // Fire and forget: a handler answers with an `update`, not with a reply.
    this.#post({ type: 'event', nodeId, elementId, kind, point })
  }

  dispose(nodeId: string): void {
    if (!this.#worker) return
    this.#post({ type: 'dispose', nodeId })
  }

  /** Kills the thread and everything queued on it. Every session's state dies with it. */
  #restart(): void {
    this.#worker?.terminate()
    this.#worker = null
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('The code worker was restarted.'))
    }
    this.#pending.clear()
  }
}
