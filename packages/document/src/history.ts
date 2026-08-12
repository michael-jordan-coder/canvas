import type { NodeId, SceneNode } from './node.js'

/** A node as it was, or null when it did not exist at that point. */
export type NodeSnapshot = SceneNode | null

export interface HistoryEntry {
  /** Every node the step touched, as it was before. */
  before: Map<NodeId, NodeSnapshot>
  /** The same ids, as they were after. */
  after: Map<NodeId, NodeSnapshot>
  sideBefore: unknown
  sideAfter: unknown
}

/**
 * State that belongs with an undo step but not to the document.
 *
 * Selection is the reason this exists. Undoing a delete should bring back what was deleted
 * *and* reselect it, but selection is not part of the file, so the document must not know
 * what it is. The app registers a capture and a restore, and history moves an opaque value
 * around without ever looking inside it.
 */
export interface SideState<T> {
  capture: () => T
  restore: (value: T) => void
}

const DEFAULT_LIMIT = 200

/**
 * Two stacks. Nothing clever.
 *
 * The capture and apply logic lives on SceneDocument, because only it can reach the nodes.
 * This is only the bookkeeping.
 */
export class History {
  #undo: HistoryEntry[] = []
  #redo: HistoryEntry[] = []
  #limit: number

  constructor(limit: number = DEFAULT_LIMIT) {
    this.#limit = limit
  }

  get canUndo(): boolean {
    return this.#undo.length > 0
  }

  get canRedo(): boolean {
    return this.#redo.length > 0
  }

  /** How many steps back you can currently go. Useful in tests and in a debug readout. */
  get depth(): number {
    return this.#undo.length
  }

  get limit(): number {
    return this.#limit
  }

  push(entry: HistoryEntry): void {
    this.#undo.push(entry)
    // Oldest first. Past the limit the earliest steps become unreachable, which is the
    // standard trade: unbounded history in a tool people leave open for days is a leak, and
    // a hard stop that refuses further edits would be worse than forgetting.
    while (this.#undo.length > this.#limit) this.#undo.shift()
    // A new edit invalidates the redo branch. There is no tree here, only a line.
    this.#redo.length = 0
  }

  takeUndo(): HistoryEntry | null {
    const entry = this.#undo.pop()
    if (!entry) return null
    this.#redo.push(entry)
    return entry
  }

  takeRedo(): HistoryEntry | null {
    const entry = this.#redo.pop()
    if (!entry) return null
    this.#undo.push(entry)
    return entry
  }

  clear(): void {
    this.#undo.length = 0
    this.#redo.length = 0
  }
}
