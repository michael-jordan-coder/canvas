import {
  applyLayout,
  computeLayout,
  createFrame,
  inferLayout,
  invert,
  isAutoLayoutFrame,
  layoutRootsFor,
  multiply,
  transformRect,
  translation,
  type FrameLayout,
  type FrameNode,
  type LayoutChild,
  type NodeId,
  type SceneDocument,
  type SceneNode,
  type TextMeasurer,
} from '@canvas/document'

/**
 * Where auto layout meets the document, in the same spot z-order commands live: the scene
 * model offers the pure engine, and turning "this changed" into "these frames move their
 * children" belongs up here.
 *
 * Every mutation that can disturb a layout calls `relayout` inside its own transaction, so
 * the layout's writes land in the same history step as the edit that caused them. That is
 * the entire undo story: a step's snapshots already hold both, and undo never runs layout.
 */

/**
 * How the layout measures text, registered by `font.ts` once the cache and the metrics
 * exist. Registered rather than imported, because importing the font module drags in the
 * atlas fetch and the live scene, and everything here has to work against any document a
 * test hands it. Until registration, text keeps its height, the same answer the font module
 * gives before the font arrives.
 */
let measurer: TextMeasurer = { measure: () => null }

export function setTextMeasurer(next: TextMeasurer): void {
  measurer = next
}

/**
 * Re-lays-out every auto layout frame that `dirty` touches, ancestors included.
 *
 * Callers pass the ids they changed; the walk finds the affected layout roots and the
 * engine's recursion covers everything below them. Call it inside the transaction that made
 * the change. `exclude` keeps a node out of the flow, which the reorder drag uses for the
 * node following the pointer.
 */
export function relayout(
  doc: SceneDocument,
  dirty: Iterable<NodeId>,
  exclude?: ReadonlySet<NodeId>,
): void {
  const roots = layoutRootsFor(doc, dirty)
  if (roots.length === 0) return
  doc.transact(() => {
    for (const root of roots) applyLayout(doc, computeLayout(doc, root, measurer, exclude))
  })
}

/**
 * Every auto layout frame in the document, for the moments that invalidate all of them at
 * once: a file load and the font's arrival. Not an edit at either moment, so the caller
 * clears history afterwards, the same contract `remeasureAll` has.
 */
export function relayoutAll(doc: SceneDocument): void {
  const frames: NodeId[] = []
  for (const node of doc.walk()) if (isAutoLayoutFrame(node)) frames.push(node.id)
  relayout(doc, frames)
}

/**
 * Switches auto layout on, reading the direction, gap and padding off where the children
 * already sit so nothing jumps, and sorting the child order to match what the eye already
 * sees. One transaction, one undo step.
 */
export function addAutoLayout(doc: SceneDocument, frameId: NodeId): void {
  const frame = doc.getNode(frameId)
  if (frame?.type !== 'frame' || frame.layout) return

  const inferred = inferLayout(doc, frameId)
  doc.transact(() => {
    inferred.childOrder.forEach((id, index) => doc.reorder(id, index))
    doc.update<FrameNode>(frameId, { layout: inferred.layout })
    relayout(doc, [frameId])
  })
}

/** What a wrap leaves around the selection, Figma's own default for a new auto layout. */
const WRAP_PADDING = 10

/**
 * Wraps a selection in a new auto layout frame, the way Shift+A treats anything that is
 * not already a frame: a text node, a shape, or several of anything.
 *
 * The frame is drawn `WRAP_PADDING` around the selection's bounds in the target parent's
 * space and hugs on both axes. The wrapped nodes keep their world positions, so against
 * that box the padding infers to exactly the margin the frame was given, and enabling the
 * layout moves nothing: the wrap is a regrouping, not a rearrangement. The frame does not
 * clip and has no fill, since it exists to carry the layout rather than to paint. Returns
 * the frame for the caller to select, or null when nothing wrappable was given. One
 * transaction, so the caller's selection change can join the same undo step.
 */
export function wrapInAutoLayout(doc: SceneDocument, ids: readonly NodeId[]): FrameNode | null {
  // Roots only: wrapping a frame together with one of its own children must not also pull
  // the child out beside its parent, the same collapse copy and paste applies.
  const selected = new Set(ids)
  const hasSelectedAncestor = (id: NodeId): boolean => {
    let current = doc.getNode(id)
    while (current?.parent) {
      if (selected.has(current.parent)) return true
      current = doc.getNode(current.parent)
    }
    return false
  }
  const roots = ids.filter((id) => doc.getNode(id) && !hasSelectedAncestor(id))
  const first = roots[0]
  if (!first) return null

  // The frame lands beside the first root, in its parent, where the eye expects the group
  // to stay. Roots picked up from other parents are carried across by reparent.
  const parentId = doc.expectNode(first).parent ?? doc.rootId
  const insertIndex = Math.max(0, doc.indexOf(first))

  const intoParent = invert(doc.worldTransform(parentId))
  const boxes = roots.map((id) => {
    const node = doc.expectNode(id)
    const inParent = multiply(doc.worldTransform(id), intoParent)
    return transformRect(inParent, { x: 0, y: 0, ...node.size })
  })
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const frame = createFrame({
    transform: translation(minX - WRAP_PADDING, minY - WRAP_PADDING),
    size: {
      width: Math.max(...boxes.map((box) => box.x + box.width)) - minX + WRAP_PADDING * 2,
      height: Math.max(...boxes.map((box) => box.y + box.height)) - minY + WRAP_PADDING * 2,
    },
    clipsContent: false,
  })

  return doc.transact(() => {
    doc.insert(frame, parentId, insertIndex)
    for (const id of roots) doc.reparent(id, frame.id)
    const inferred = inferLayout(doc, frame.id)
    inferred.childOrder.forEach((id, index) => doc.reorder(id, index))
    doc.update<FrameNode>(frame.id, {
      // Hug on both axes, because a frame that exists to hold a group should keep fitting
      // it as the group changes. It already fits, so nothing moves now.
      layout: { ...inferred.layout, mainSizing: 'hug', crossSizing: 'hug' },
    })
    relayout(doc, [frame.id])
    return frame
  })
}

/** Switches it off. Children keep the positions the layout gave them, so nothing else moves. */
export function removeAutoLayout(doc: SceneDocument, frameId: NodeId): void {
  const frame = doc.getNode(frameId)
  if (frame?.type !== 'frame' || !frame.layout) return
  doc.update<FrameNode>(frameId, { layout: undefined })
}

/** The Shift+A gesture: one key, either direction. */
export function toggleAutoLayout(doc: SceneDocument, frameId: NodeId): void {
  const frame = doc.getNode(frameId)
  if (frame?.type !== 'frame') return
  if (frame.layout) removeAutoLayout(doc, frameId)
  else addAutoLayout(doc, frameId)
}

/** A panel edit to the layout itself: direction, gap, padding, alignment, sizing. */
export function updateFrameLayout(
  doc: SceneDocument,
  frameId: NodeId,
  changes: Partial<FrameLayout>,
): void {
  const frame = doc.getNode(frameId)
  if (frame?.type !== 'frame' || !frame.layout) return
  const layout = frame.layout
  doc.transact(() => {
    doc.update<FrameNode>(frameId, {
      layout: {
        ...layout,
        ...changes,
        padding: { ...(changes.padding ?? layout.padding) },
      },
    })
    relayout(doc, [frameId])
  })
}

/**
 * A child's fill/fixed choice per axis.
 *
 * Setting fill on a frame that hugs the same axis also flips that axis to fixed, because a
 * frame sized by its children while a child is sized by the frame is a question with no
 * answer, and Figma resolves it the same way: fill wins.
 */
export function updateLayoutChild(
  doc: SceneDocument,
  node: SceneNode,
  changes: Partial<LayoutChild>,
): void {
  const layoutChild: LayoutChild = {
    widthMode: 'fixed',
    heightMode: 'fixed',
    ...node.layoutChild,
    ...changes,
  }

  doc.transact(() => {
    doc.update(node.id, { layoutChild })

    if (node.type === 'frame' && node.layout) {
      const horizontal = node.layout.direction === 'horizontal'
      const patch: Partial<FrameLayout> = {}
      const fillsMain = horizontal ? layoutChild.widthMode : layoutChild.heightMode
      const fillsCross = horizontal ? layoutChild.heightMode : layoutChild.widthMode
      if (fillsMain === 'fill' && node.layout.mainSizing === 'hug') patch.mainSizing = 'fixed'
      if (fillsCross === 'fill' && node.layout.crossSizing === 'hug') patch.crossSizing = 'fixed'
      if (Object.keys(patch).length > 0) updateFrameLayout(doc, node.id, patch)
    }

    relayout(doc, [node.id])
  })
}
