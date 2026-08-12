import { multiply, type Mat2D, IDENTITY } from './math.js'
import { canHaveChildren, createPage, type NodeId, type SceneNode } from './node.js'

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
    for (const childId of [...node.children]) this.remove(childId)
    if (node.parent) {
      const parent = this.expectNode(node.parent)
      parent.children = parent.children.filter((childId) => childId !== id)
      this.#touch(parent.id, true)
    }
    this.#nodes.delete(id)
    this.#touch(id, true)
    this.#flush()
  }

  /**
   * Patches a node in place. Typed per node so a rectangle's `cornerRadius` cannot be set
   * on an ellipse.
   */
  update<T extends SceneNode>(id: NodeId, patch: Partial<Omit<T, 'id' | 'type'>>): void {
    const node = this.#nodes.get(id)
    if (!node) return
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

  #touch(id: NodeId, structural: boolean): void {
    this.#pending.add(id)
    if (structural) this.#pendingStructural = true
  }

  #flush(): void {
    if (this.#depth > 0 || this.#pending.size === 0) return
    this.#version += 1
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
