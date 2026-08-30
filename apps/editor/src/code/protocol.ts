import type { CodeElementEvents, JsonValue } from '@canvas/document'

/**
 * The messages between the editor and the code worker. Both ends live in this app, so this
 * is a private contract rather than a wire format, but the same discipline applies: data
 * only, because structured clone is the transport, and trees arrive as `unknown` because
 * the worker runs arbitrary code and arbitrary code holds `postMessage`. The main thread
 * validates; the types here do not vouch for the payload.
 */

/**
 * `static` renders once and runs no effects, the way a server render mounts nothing: the
 * canvas is showing a snapshot. `live` is play mode: effects run, state changes re-render,
 * and `update` messages follow.
 */
export type RunMode = 'static' | 'live'

export type CodeWorkerRequest =
  | {
      type: 'run'
      id: number
      nodeId: string
      source: string
      props: Record<string, JsonValue>
      mode: RunMode
      /** Drops the node's hook state first, so the run starts from the code's beginning. */
      fresh: boolean
    }
  | {
      type: 'event'
      nodeId: string
      elementId: string
      kind: keyof CodeElementEvents
      /** In the code node's own space. */
      point: { x: number; y: number }
    }
  | { type: 'dispose'; nodeId: string }

export type CodeWorkerResponse =
  | { type: 'result'; id: number; nodeId: string; ok: true; tree: unknown }
  | { type: 'result'; id: number; nodeId: string; ok: false; error: string }
  /** An unsolicited re-render, after a state change in live mode. */
  | { type: 'update'; nodeId: string; tree: unknown }
  | { type: 'update-error'; nodeId: string; error: string }
