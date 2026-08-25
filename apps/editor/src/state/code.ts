import { create } from 'zustand'
import {
  applyCodeTree,
  applyToPoint,
  containsPoint,
  createCode,
  generatedBounds,
  invert,
  multiply,
  translation,
  validateCodeTree,
  type Mat2D,
  type CodeElement,
  type CodeElementEvents,
  type CodeNode,
  type JsonValue,
  type NodeId,
  type TextNode,
} from '@canvas/document'
import { CodeWorkerClient } from '../code/workerClient'
import { relayout } from './autoLayout'
import { fontMetrics, textLayouts } from './font'
import { scene } from './scene'
import { endEditing } from './textEditing'
import { useUI } from './uiStore'

/**
 * The one door for everything that runs a code node, the same door `updateText` is for
 * text: whatever writes the source writes the generated children and the measured size in
 * the same transaction, so a step is a step and undo restores all three together.
 *
 * The run itself is async, the worker being another thread, so the order is always: await
 * the tree OUTSIDE any transaction, then commit everything in one synchronous transact. An
 * await inside a transaction is not a smaller mistake, it is a different program: the
 * transaction would close before the result existed.
 */

interface CodeStatus {
  /** Compile, runtime or validation failure per node. Absent means the last run was clean. */
  errors: ReadonlyMap<NodeId, string>
  setError: (id: NodeId, error: string | null) => void
}

/** A store rather than a module map, because the panel renders the badge from it. */
export const useCodeStatus = create<CodeStatus>()((set) => ({
  errors: new Map<NodeId, string>(),
  setError: (id, error) =>
    set((state) => {
      if ((state.errors.get(id) ?? null) === error) return state
      const next = new Map(state.errors)
      if (error === null) next.delete(id)
      else next.set(id, error)
      return { errors: next }
    }),
}))

/**
 * The last applied tree's event declarations, element id to flags, per code node. Play
 * routing reads it to answer "does anything here want this click" without another walk of
 * the elements. Module state rather than store state: nothing renders from it.
 */
const eventsByNode = new Map<NodeId, Map<string, CodeElementEvents>>()

/** Runs are latest-wins per node: a token stamped out by a newer run drops its result. */
const runTokens = new Map<NodeId, number>()

const measureText = (node: TextNode): { width: number; height: number } | null => {
  const metrics = fontMetrics()
  return metrics ? textLayouts.measure(node, metrics) : null
}

const client = new CodeWorkerClient({
  onUpdate: (nodeId, tree) => {
    // A stray timer after play ended must not edit the document; the session is already
    // disposed, this message just lost the race.
    if (useUI.getState().play !== nodeId) return
    try {
      applyTree(nodeId as NodeId, validateCodeTree(tree))
      useCodeStatus.getState().setError(nodeId as NodeId, null)
    } catch (error) {
      useCodeStatus.getState().setError(nodeId as NodeId, messageOf(error))
    }
  },
  onUpdateError: (nodeId, error) => {
    useCodeStatus.getState().setError(nodeId as NodeId, error)
  },
})

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function collectEvents(roots: readonly CodeElement[], into: Map<string, CodeElementEvents>): void {
  for (const element of roots) {
    if (element.events) into.set(element.id, element.events)
    if (element.children) collectEvents(element.children, into)
  }
}

/**
 * How many code runs are writing to the document right now. `rerunAllCodeNodes` reads it to
 * tell its own writes from a person's while it waits for the worker.
 */
let applying = 0

/** What an empty run leaves behind, so a code node producing nothing is still a box. */
const EMPTY_CODE_SIZE = { width: 160, height: 120 }

/**
 * Commits a validated tree: children reconciled, layout run, text measured, and the code
 * node's `size` refreshed from the output's bounds, all in one transaction. `extra` is how
 * a source edit rides in the same step.
 */
function applyTree(id: NodeId, roots: CodeElement[], extra?: () => void): void {
  const node = scene.getNode(id)
  if (node?.type !== 'code') return

  const events = new Map<string, CodeElementEvents>()
  collectEvents(roots, events)
  eventsByNode.set(id, events)

  applying += 1
  try {
    scene.transact(() => {
      extra?.()
      const childIds = applyCodeTree(scene, id, roots, measureText)
      relayout(scene, childIds.length > 0 ? childIds : [id])
      const bounds = generatedBounds(scene, id)
      // The origin stays the node's own: output at x 50 grows the box, it does not shift it.
      // A run that produced nothing falls back to the empty box rather than keeping the size
      // the last output measured, which would leave an invisible rectangle that still hit
      // tests and still clips. Not zero, because a node nothing can point at is one only the
      // layers panel can reach.
      const width = bounds ? Math.max(0, bounds.x + bounds.width) : EMPTY_CODE_SIZE.width
      const height = bounds ? Math.max(0, bounds.y + bounds.height) : EMPTY_CODE_SIZE.height
      const current = scene.expectNode(id)
      if (
        Math.abs(current.size.width - width) > 0.01 ||
        Math.abs(current.size.height - height) > 0.01
      ) {
        scene.update(id, { size: { width, height } })
      }
    })
  } finally {
    applying -= 1
  }
}

async function execute(
  id: NodeId,
  source: string,
  props: Record<string, JsonValue>,
  mode: 'static' | 'live',
  fresh: boolean,
  extra?: () => void,
): Promise<boolean> {
  const token = (runTokens.get(id) ?? 0) + 1
  runTokens.set(id, token)
  /*
   * A node that is playing runs live whatever the caller asked for. Callers are not all in a
   * position to know: the panel commits pending keystrokes as its editor is torn down, which
   * is exactly what entering play does to it, and that static run would land after the live
   * one and leave the worker session static. The prototype would then look like it is
   * playing and answer no event at all.
   */
  const runMode = useUI.getState().play === id ? 'live' : mode
  try {
    const raw = await client.run(id, source, props, runMode, fresh)
    if (runTokens.get(id) !== token) return false
    const roots = validateCodeTree(raw)
    applyTree(id, roots, extra)
    useCodeStatus.getState().setError(id, null)
    return true
  } catch (error) {
    if (runTokens.get(id) !== token) return false
    // The source still commits on a failed run: the user typed it and it must not vanish,
    // exactly as a document with a syntax error is still a document. The old children
    // stand until a run succeeds, so the canvas shows the last good output plus the badge.
    if (extra) scene.transact(extra)
    useCodeStatus.getState().setError(id, messageOf(error))
    return false
  }
}

/** The panel's commit: write the source and re-run in one step. */
export function updateCodeSource(id: NodeId, source: string): void {
  const node = scene.getNode(id)
  if (node?.type !== 'code' || node.source === source) return
  void execute(id, source, node.props, 'static', true, () => {
    scene.update<CodeNode>(id, { source })
  })
}

export function updateCodeProps(id: NodeId, props: Record<string, JsonValue>): void {
  const node = scene.getNode(id)
  if (node?.type !== 'code') return
  void execute(id, node.source, props, 'static', true, () => {
    scene.update<CodeNode>(id, { props })
  })
}

/**
 * The agent's awaited variant: runs and answers with the failure text or null, so the tool
 * result can carry "line 3: Unexpected token" back to the model instead of a silent badge
 * the model cannot see.
 */
export async function runCodeNodeNow(id: NodeId): Promise<string | null> {
  const node = scene.getNode(id)
  if (node?.type !== 'code') return `${id} is not a code node`
  const ok = await execute(id, node.source, node.props, 'static', true)
  return ok ? null : (useCodeStatus.getState().errors.get(id) ?? 'the run failed')
}

/** The agent's source/props write: same one-step commit the panel makes, awaited. */
export async function setCodeSourceNow(
  id: NodeId,
  changes: { source?: string; props?: Record<string, JsonValue> },
): Promise<string | null> {
  const node = scene.getNode(id)
  if (node?.type !== 'code') return `${id} is not a code node`
  const source = changes.source ?? node.source
  const props = changes.props ?? node.props
  const ok = await execute(id, source, props, 'static', true, () => {
    scene.update<CodeNode>(id, { source, props })
  })
  return ok ? null : (useCodeStatus.getState().errors.get(id) ?? 'the run failed')
}

/** Re-runs from what the document already holds: paste, duplicate, agent edits. */
export function rerunCodeNode(id: NodeId): void {
  const node = scene.getNode(id)
  if (node?.type !== 'code') return
  void execute(id, node.source, node.props, 'static', true)
}

/**
 * After a paste or a duplicate: the copy arrived with a source and no children, because the
 * clipboard strips generated output, so anything code-shaped in the new subtrees runs now.
 * The regeneration is its own history step after the paste's; undoing a paste therefore
 * takes two steps when it contained a code node, which is accepted and noted in TASKS.md.
 */
export function rerunCodeNodesIn(roots: readonly NodeId[]): void {
  for (const rootId of roots) {
    for (const node of scene.walk(rootId)) {
      if (node.type === 'code') rerunCodeNode(node.id)
    }
  }
}

/**
 * The load path: every code node in the file runs once, and none of it is an edit, so
 * history clears when the last one lands. The `remeasureAll` rule, applied to code.
 */
export function rerunAllCodeNodes(): void {
  const ids: NodeId[] = []
  for (const node of scene.walk()) if (node.type === 'code') ids.push(node.id)
  if (ids.length === 0) return

  /*
   * The runs are a round trip to a worker that may still be starting, and the person can
   * draw and move things while it does. Their steps are real history, so the clear at the
   * end has to be able to tell them from the runs' own writes: anything notified while no
   * run is applying is theirs, and it takes the clear off the table.
   */
  let edited = false
  const stopWatching = scene.subscribe(() => {
    if (applying === 0) edited = true
  })

  void Promise.all(
    ids.map((id) => {
      const node = scene.getNode(id)
      if (node?.type !== 'code') return Promise.resolve(false)
      return execute(id, node.source, node.props, 'static', true)
    }),
  ).then(() => {
    stopWatching()
    if (!edited) scene.clearHistory()
  })
}

/**
 * What a fresh code node holds: small enough to read in one look, big enough to show the
 * whole vocabulary, props, a list with keys, state and a click handler included.
 */
const STARTER_SOURCE = `interface Props {
  items?: string[]
}

export default function App(props: Props) {
  const items = props.items ?? ['One', 'Two', 'Three']
  const [active, setActive] = useState(items[0])
  return (
    <Frame direction="column" gap={8} padding={16} background="#ffffff" borderRadius={12}>
      {items.map((item) => (
        <Frame
          key={item}
          padding={10}
          borderRadius={8}
          background={item === active ? '#0a7cff' : '#f0f0f0'}
          onClick={() => setActive(item)}
        >
          <Text fontSize={14} color={item === active ? '#ffffff' : '#111111'}>
            {item}
          </Text>
        </Frame>
      ))}
    </Frame>
  )
}
`

/** The toolbar's insert: a ready-to-run code node beside whatever the page already holds. */
export function insertCodeNode(): void {
  let x = 60
  for (const child of scene.getChildren(scene.rootId)) {
    x = Math.max(x, child.transform.tx + child.size.width + 40)
  }
  const node = createCode({ source: STARTER_SOURCE, transform: translation(x, 60) })
  scene.transact(() => {
    scene.insert(node)
    // In the step, not after it: the step's "after" selection is captured when it commits,
    // so a selection written outside would leave redo restoring the one from before.
    useUI.getState().setSelection([node.id])
    useUI.getState().setContext(null)
  })
  rerunCodeNode(node.id)
}

// Play mode ------------------------------------------------------------------------------

/**
 * Play brackets the whole session in one history group and aborts it on the way out.
 * While the group is open every transact folds into it and nothing lands on the undo
 * stack; exit re-runs the code fresh, which deterministically restores the pre-play tree,
 * and only then discards the group. The stack never learns play happened, and the user's
 * real history is exactly as they left it. `abortHistoryGroup` exists for a cancelled
 * gesture, and a play session is that gesture at scale.
 */
/**
 * Bumped every time a session starts. The input layer keys its hover bookkeeping to it, so
 * an element hovered in one session is not mistaken for the same element still being
 * hovered in the next: the enter it is owed would otherwise be diffed away.
 */
let generation = 0

export function playGeneration(): number {
  return generation
}

/**
 * True from the moment play starts until the exit's history group has actually been
 * discarded, which is a worker round trip after `play` goes null. Undo asks this rather than
 * the store, because the group is still open through that window and a step applied
 * underneath it is the very thing the bracketing exists to prevent.
 */
let exiting = false

export function isPlayLocked(): boolean {
  return useUI.getState().play !== null || exiting
}

export function beginPlay(id: NodeId): void {
  const node = scene.getNode(id)
  if (node?.type !== 'code') return
  if (useUI.getState().play === id) return
  endPlay()
  endEditing()
  generation += 1
  scene.beginHistoryGroup()
  useUI.getState().setPlay(id)
  useUI.getState().setSelection([id])
  void execute(id, node.source, node.props, 'live', true)
}

export function endPlay(): void {
  const id = useUI.getState().play
  if (!id) return
  useUI.getState().setPlay(null)
  client.dispose(id)
  const node = scene.getNode(id)
  if (node?.type !== 'code') {
    scene.abortHistoryGroup()
    return
  }
  exiting = true
  void execute(id, node.source, node.props, 'static', true).finally(() => {
    scene.abortHistoryGroup()
    exiting = false
  })
}

/** A closed tab mid-play must not autosave half a prototype as the document. */
if (typeof window !== 'undefined') window.addEventListener('pagehide', endPlay)

// Event routing --------------------------------------------------------------------------

/**
 * The deepest element under a code-local point that declared `kind`, bubbling through its
 * ancestors, which are simply its id's prefixes. Returns null when nothing wants it.
 */
export function playTargetAt(
  id: NodeId,
  elementId: string | null,
  kind: keyof CodeElementEvents,
): string | null {
  const events = eventsByNode.get(id)
  if (!events || elementId === null) return null
  let path: string | null = elementId
  while (path !== null) {
    if (events.get(path)?.[kind]) return path
    const cut = path.lastIndexOf('/')
    path = cut === -1 ? null : path.slice(0, cut)
  }
  return null
}

export function sendPlayEvent(
  id: NodeId,
  elementId: string,
  kind: keyof CodeElementEvents,
  point: { x: number; y: number },
): void {
  client.event(id, elementId, kind, point)
}

/** Where a pointer stands relative to the playing prototype. */
export interface PlayHit {
  /** The deepest generated element under the point, or null over bare code-node ground. */
  elementId: string | null
  /** The point in the code node's own space, which is what handlers receive. */
  point: { x: number; y: number }
}

/**
 * The play-mode answer to "what is under the pointer". The ordinary `hitTest` cannot give
 * it: generated children are locked, and locked is exactly what it skips. This walk reads
 * the same geometry the same way, front to back, but sees through the lock, because play
 * is the one mode in which the output is the thing being touched.
 *
 * Null means the pointer is outside the code node entirely, which is how the input layer
 * knows a click is an exit rather than an interaction.
 */
export function playHitAt(id: NodeId, world: { x: number; y: number }): PlayHit | null {
  const code = scene.getNode(id)
  if (code?.type !== 'code') return null
  const codeWorld = scene.worldTransform(id)
  const local = applyToPoint(invert(codeWorld), world)
  const inside =
    local.x >= 0 && local.y >= 0 && local.x <= code.size.width && local.y <= code.size.height
  if (!inside) return null

  const deepest = (parentId: NodeId, parentWorld: Mat2D): string | null => {
    const children = scene.getChildren(parentId)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (!child || !child.visible) continue
      const childWorld = multiply(child.transform, parentWorld)
      const fromBelow = deepest(child.id, childWorld)
      if (fromBelow) return fromBelow
      if (child.sourceKey === undefined) continue
      if (containsPoint(child, applyToPoint(invert(childWorld), world))) return child.sourceKey
    }
    return null
  }

  return { elementId: deepest(id, codeWorld), point: { x: local.x, y: local.y } }
}
