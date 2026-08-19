import { invert, multiply, type Mat2D, IDENTITY } from './math.js'
import {
  canHaveChildren,
  cloneNode,
  createPage,
  reserveNodeIds,
  type NodeId,
  type SceneNode,
} from './node.js'
import { History, type HistoryEntry, type NodeSnapshot, type SideState } from './history.js'

export interface DocumentChange {
  /** Monotonic. Cheap way for the renderer to ask "is anything different since my last frame". */
  readonly version: number
  readonly changed: ReadonlySet<NodeId>
  /** True when nodes were added, removed or reparented, so caches keyed by structure are stale. */
  readonly structural: boolean
}

export type DocumentListener = (change: DocumentChange) => void

/**
 * The scene, and the only thing that owns it.
 *
 * Deliberately mutable and outside React. The renderer reads it directly on every frame at
 * whatever rate the display runs, so making it immutable would mean allocating a new tree
 * 120 times a second during a drag. React subscribes through `subscribe` and re-reads only
 * the slices a panel actually shows.
 */
export class SceneDocument {
  #nodes = new Map<NodeId, SceneNode>()
  #root: NodeId
  #version = 0
  #listeners = new Set<DocumentListener>()

  #depth = 0
  #pending = new Set<NodeId>()
  #pendingStructural = false

  #history = new History()
  /** Before-snapshots for the step being built. Null between steps. */
  #recording: Map<NodeId, NodeSnapshot> | null = null
  #sideBefore: unknown = undefined
  #side: { capture: () => unknown; restore: (value: unknown) => void } | null = null
  /** True while undo or redo is writing, so restoring does not record itself as a new step. */
  #applying = false
  #group: HistoryEntry | null = null
  #groupDepth = 0

  constructor() {
    const page = createPage()
    this.#nodes.set(page.id, page)
    this.#root = page.id
  }

  get version(): number {
    return this.#version
  }

  get rootId(): NodeId {
    return this.#root
  }

  get size(): number {
    return this.#nodes.size
  }

  getNode(id: NodeId): SceneNode | undefined {
    return this.#nodes.get(id)
  }

  /** Throws rather than returning undefined, for the many call sites where absence is a bug. */
  expectNode(id: NodeId): SceneNode {
    const node = this.#nodes.get(id)
    if (!node) throw new Error(`No node ${id}`)
    return node
  }

  getChildren(id: NodeId): SceneNode[] {
    const node = this.#nodes.get(id)
    if (!node) return []
    return node.children.map((childId) => this.expectNode(childId))
  }

  /** Back to front, which is also the order the renderer submits them in. */
  *walk(from: NodeId = this.#root): Generator<SceneNode> {
    const node = this.#nodes.get(from)
    if (!node) return
    yield node
    for (const childId of node.children) yield* this.walk(childId)
  }

  /**
   * Local to world. The node's own transform applies first, then each ancestor's in turn,
   * and `multiply(m, n)` applies m first, so `result` stays on the left as it walks up.
   *
   * O(depth) per call. Fine for one node, wrong for a whole frame: the renderer walks down
   * from the root instead, accumulating as it goes.
   */
  worldTransform(id: NodeId): Mat2D {
    let node = this.#nodes.get(id)
    let result: Mat2D = node ? node.transform : { ...IDENTITY }
    while (node?.parent) {
      const parent = this.expectNode(node.parent)
      result = multiply(result, parent.transform)
      node = parent
    }
    return result
  }

  insert(node: SceneNode, parentId: NodeId = this.#root, index?: number): SceneNode {
    const parent = this.expectNode(parentId)
    if (!canHaveChildren(parent)) throw new Error(`${parent.type} cannot hold children`)
    // Before the splice, so the parent is recorded with its original child order.
    this.#captureBefore(parentId)
    this.#captureBefore(node.id)
    this.#nodes.set(node.id, node)
    node.parent = parentId
    const at = index ?? parent.children.length
    parent.children.splice(at, 0, node.id)
    this.#touch(parentId, true)
    this.#touch(node.id, true)
    this.#flush()
    return node
  }

  remove(id: NodeId): void {
    const node = this.#nodes.get(id)
    if (!node || id === this.#root) return

    // Wrapped, because this recurses. Without the transaction each nested call would reach
    // depth zero and commit its own history step, and by the last one the parent's recorded
    // "before" would already have lost the children removed by the earlier ones. Undo would
    // then restore an empty frame. One removal is one step, however deep the subtree.
    this.transact(() => {
      for (const childId of [...node.children]) this.remove(childId)
      if (node.parent) {
        // Captured before the filter below. On the first child of a subtree removal this
        // also captures the parent while its children array is still intact, and first
        // capture wins, so the subtree restores in its original order with no index tracking.
        this.#captureBefore(node.parent)
        const parent = this.expectNode(node.parent)
        parent.children = parent.children.filter((childId) => childId !== id)
        this.#touch(parent.id, true)
      }
      this.#captureBefore(id)
      this.#nodes.delete(id)
      this.#touch(id, true)
    })
  }

  /** Position among its siblings, or -1. Index 0 is the back of the stack. */
  indexOf(id: NodeId): number {
    const node = this.#nodes.get(id)
    if (!node?.parent) return -1
    return this.expectNode(node.parent).children.indexOf(id)
  }

  isAncestorOf(ancestorId: NodeId, id: NodeId): boolean {
    let node = this.#nodes.get(id)
    while (node?.parent) {
      if (node.parent === ancestorId) return true
      node = this.#nodes.get(node.parent)
    }
    return false
  }

  /** Moves a node among its siblings. Clamped, so callers can pass index - 1 without care. */
  reorder(id: NodeId, index: number): void {
    const node = this.#nodes.get(id)
    if (!node?.parent) return
    const parent = this.expectNode(node.parent)
    const from = parent.children.indexOf(id)
    if (from < 0) return
    const to = Math.max(0, Math.min(parent.children.length - 1, index))
    if (from === to) return

    this.transact(() => {
      this.#captureBefore(parent.id)
      const next = [...parent.children]
      next.splice(from, 1)
      next.splice(to, 0, id)
      parent.children = next
      this.#touch(parent.id, true)
    })
  }

  /**
   * Moves a node to a different parent, leaving it exactly where it appears to be.
   *
   * The transform a node carries is relative to its parent, so moving it between parents
   * without changing that transform makes it jump, and the jump is proportional to how
   * differently the two parents are scaled. Recomputing it against the new parent is the
   * whole job:
   *
   *   world  = local  then oldParentWorld
   *   local' = world  then inverse(newParentWorld)
   *
   * Refuses to put a node inside itself or inside one of its own descendants, which would
   * detach that subtree from the tree entirely and leak it.
   */
  reparent(id: NodeId, parentId: NodeId, index?: number): void {
    const node = this.#nodes.get(id)
    const parent = this.#nodes.get(parentId)
    if (!node || !parent || id === this.#root) return
    if (!canHaveChildren(parent)) return
    if (id === parentId || this.isAncestorOf(id, parentId)) return

    const world = this.worldTransform(id)
    const parentWorld = this.worldTransform(parentId)

    this.transact(() => {
      if (node.parent) {
        this.#captureBefore(node.parent)
        const previous = this.expectNode(node.parent)
        previous.children = previous.children.filter((childId) => childId !== id)
        this.#touch(previous.id, true)
      }

      this.#captureBefore(parentId)
      this.#captureBefore(id)

      const at = Math.max(0, Math.min(parent.children.length, index ?? parent.children.length))
      parent.children.splice(at, 0, id)
      node.parent = parentId
      node.transform = multiply(world, invert(parentWorld))

      this.#touch(parentId, true)
      this.#touch(id, true)
    })
  }

  /**
   * Patches a node in place. Typed per node so a rectangle's `cornerRadius` cannot be set
   * on an ellipse.
   */
  update<T extends SceneNode>(id: NodeId, patch: Partial<Omit<T, 'id' | 'type'>>): void {
    const node = this.#nodes.get(id)
    if (!node) return
    this.#captureBefore(id)
    Object.assign(node, patch)
    this.#touch(id, false)
    this.#flush()
  }

  /**
   * Coalesces every change inside `fn` into one notification. A drag that moves fifty nodes
   * should wake the panels once, not fifty times.
   */
  transact<T>(fn: () => T): T {
    this.#depth += 1
    try {
      return fn()
    } finally {
      this.#depth -= 1
      this.#flush()
    }
  }

  subscribe(listener: DocumentListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Replaces the entire contents, in place.
   *
   * In place matters: the editor holds one document as a module singleton and every React
   * hook and the renderer are subscribed to it. Swapping in a new instance would leave all
   * of them watching an object nothing writes to any more.
   *
   * History is dropped, because loading a file is not an edit you undo your way out of.
   */
  load(root: NodeId, nodes: readonly SceneNode[]): void {
    const replaced = new Set<NodeId>(this.#nodes.keys())

    this.#nodes = new Map(nodes.map((node) => [node.id, cloneNode(node)]))
    this.#root = root
    // The file keeps its ids, so the generator has to be pushed past them or the next node
    // created would collide with one just loaded.
    reserveNodeIds(this.#nodes.keys())

    this.clearHistory()
    this.#recording = null

    // Everything that was here and everything that now is, so no subscriber keeps showing a
    // node from the previous document.
    for (const id of this.#nodes.keys()) replaced.add(id)
    this.#version += 1
    const change: DocumentChange = { version: this.#version, changed: replaced, structural: true }
    this.#pending = new Set()
    this.#pendingStructural = false
    for (const listener of this.#listeners) listener(change)
  }

  // History ------------------------------------------------------------------------------

  get canUndo(): boolean {
    return this.#history.canUndo
  }

  get canRedo(): boolean {
    return this.#history.canRedo
  }

  /** Steps currently on the undo stack. */
  get historyDepth(): number {
    return this.#history.depth
  }

  /**
   * Registers state that travels with an undo step but is not part of the document.
   *
   * The value is opaque here on purpose: the document must not learn what selection is.
   * Note that the value is captured when the step commits, so an edit and the selection
   * change that goes with it belong in the same `transact` if the redo is to be faithful.
   */
  setSideState<T>(side: SideState<T>): void {
    this.#side = {
      capture: side.capture,
      restore: (value) => side.restore(value as T),
    }
  }

  /**
   * Merges everything until the matching end into a single undo step.
   *
   * A drag calls `update` once per frame, which without this would put sixty steps on the
   * stack for one gesture. Callers should open the group on the first real change rather
   * than on pointer down, so a click that never moves leaves no step behind.
   */
  beginHistoryGroup(): void {
    this.#groupDepth += 1
  }

  endHistoryGroup(): void {
    if (this.#groupDepth === 0) return
    this.#groupDepth -= 1
    if (this.#groupDepth === 0 && this.#group) {
      this.#history.push(this.#group)
      this.#group = null
    }
  }

  /**
   * Discards a history group instead of committing it.
   *
   * Used when a gesture is cancelled rather than completed. Restoring the live nodes to their
   * pre-gesture state and then calling `endHistoryGroup` would still push a step onto the
   * stack, one whose before and after are identical: a no-op sitting on the undo history for
   * no reason. Discarding the group instead leaves no trace at all.
   */
  abortHistoryGroup(): void {
    if (this.#groupDepth === 0) return
    this.#groupDepth -= 1
    if (this.#groupDepth === 0) this.#group = null
  }

  undo(): boolean {
    const entry = this.#history.takeUndo()
    if (!entry) return false
    this.#apply(entry.before, entry.sideBefore)
    return true
  }

  redo(): boolean {
    const entry = this.#history.takeRedo()
    if (!entry) return false
    this.#apply(entry.after, entry.sideAfter)
    return true
  }

  /** Drops the past. Called after seeding, so the starting document cannot be undone away. */
  clearHistory(): void {
    this.#history.clear()
    this.#group = null
    this.#groupDepth = 0
  }

  #captureBefore(id: NodeId): void {
    if (this.#applying) return
    if (!this.#recording) {
      this.#recording = new Map()
      // Captured before the first mutation of the step, which is what makes undo restore
      // the selection as it was rather than as the edit left it.
      this.#sideBefore = this.#side ? this.#side.capture() : undefined
    }
    // First capture wins: within one step a node's "before" is how it started, not how it
    // looked midway through.
    if (this.#recording.has(id)) return
    const node = this.#nodes.get(id)
    this.#recording.set(id, node ? cloneNode(node) : null)
  }

  #commitRecording(): void {
    const before = this.#recording
    this.#recording = null
    if (!before || this.#applying) return

    const after = new Map<NodeId, NodeSnapshot>()
    for (const id of before.keys()) {
      const node = this.#nodes.get(id)
      after.set(id, node ? cloneNode(node) : null)
    }
    const sideAfter = this.#side ? this.#side.capture() : undefined

    if (this.#groupDepth > 0) {
      if (!this.#group) {
        this.#group = { before, after, sideBefore: this.#sideBefore, sideAfter }
        return
      }
      // Oldest before, newest after, so the group reads as one step from where the gesture
      // started to where it ended.
      for (const [id, snapshot] of before) {
        if (!this.#group.before.has(id)) this.#group.before.set(id, snapshot)
      }
      for (const [id, snapshot] of after) this.#group.after.set(id, snapshot)
      this.#group.sideAfter = sideAfter
      return
    }

    this.#history.push({ before, after, sideBefore: this.#sideBefore, sideAfter })
  }

  #apply(snapshots: Map<NodeId, NodeSnapshot>, side: unknown): void {
    this.#applying = true
    try {
      for (const [id, snapshot] of snapshots) {
        if (snapshot === null) this.#nodes.delete(id)
        // Cloned on the way out too. Handing the stored snapshot to the live document would
        // let the next edit mutate history itself.
        else this.#nodes.set(id, cloneNode(snapshot))
        this.#touch(id, true)
      }
      this.#flush()
    } finally {
      this.#applying = false
    }
    if (this.#side && side !== undefined) this.#side.restore(side)
  }

  #touch(id: NodeId, structural: boolean): void {
    this.#pending.add(id)
    if (structural) this.#pendingStructural = true
  }

  #flush(): void {
    if (this.#depth > 0 || this.#pending.size === 0) return
    this.#version += 1
    // One transaction, one undo step. Nested transacts collapse into the outermost, because
    // the flush they would have triggered is deferred until depth returns to zero.
    this.#commitRecording()
    const change: DocumentChange = {
      version: this.#version,
      changed: this.#pending,
      structural: this.#pendingStructural,
    }
    this.#pending = new Set()
    this.#pendingStructural = false
    for (const listener of this.#listeners) listener(change)
  }
}
