import type { SceneDocument } from '../document.js'
import { transformRect, type Mat2D, type Rect, type Size, type Vec2 } from '../math.js'
import type { FrameLayout, FrameNode, NodeId, SceneNode, TextNode } from '../node.js'

/**
 * The auto layout engine. Pure and DOM free, like the text layout it sits beside: it reads
 * the document, computes where everything should be, and returns patches. It never writes.
 * The editor applies the patches inside whatever transaction caused the change, which is the
 * whole undo story: a step's snapshots already contain the layout's writes, so undo and redo
 * never run layout at all.
 *
 * Two properties everything downstream leans on:
 *
 * - **Idempotent.** Every emitted value is compared against what the node already holds, so
 *   laying out a settled frame returns no patches, bumps no version, and rebuilds nothing.
 *   That is also what makes cancelling a gesture safe: restore the inputs, relayout, and the
 *   result is bit for bit the original.
 * - **Resolved once.** A child's final size is computed in a single call carrying every
 *   constraint that applies to it, rather than estimated and corrected, because an estimate
 *   that a second pass would revise is a layout that disagrees with itself the next time it
 *   runs.
 *
 * Text cannot be measured here, having no DOM, so a measurer comes in from the editor the
 * same way font metrics do for text layout.
 */

/** Editor supplied. Returns null while the font has not arrived; layout keeps the old height. */
export interface TextMeasurer {
  measure(node: TextNode, wrapWidth: number): Size | null
}

export interface LayoutPatch {
  id: NodeId
  /** Only tx/ty ever change; the linear part is the node's own business. */
  transform?: Mat2D
  size?: Size
  /** Present exactly when the layout assigned a width to an auto width text node. */
  autoWidth?: false
}

const EPSILON = 1e-6

const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON

export function isAutoLayoutFrame(
  node: SceneNode | undefined,
): node is FrameNode & { layout: FrameLayout } {
  return node?.type === 'frame' && node.layout !== undefined
}

/**
 * The topmost auto layout frames affected by a set of changed nodes.
 *
 * A change to a node concerns its parent's layout, and a change to an auto frame concerns
 * its own. From there the walk climbs while the parents stay auto layout, because a hug axis
 * hands its size upward and the chain has to be solved from the top. It stops at the first
 * plain ancestor: a plain frame's size does not follow its children, so nothing above it can
 * see the change.
 *
 * On a document with no auto layout this is a one or two step walk per id that finds
 * nothing, which is what keeps stress mode free.
 */
export function layoutRootsFor(doc: SceneDocument, dirty: Iterable<NodeId>): NodeId[] {
  const roots = new Set<NodeId>()

  for (const id of dirty) {
    const node = doc.getNode(id)
    if (!node) continue

    const parent = node.parent ? doc.getNode(node.parent) : undefined
    let candidate: SceneNode | undefined
    if (isAutoLayoutFrame(parent)) candidate = parent
    else if (isAutoLayoutFrame(node)) candidate = node
    if (!candidate) continue

    while (candidate.parent) {
      const up = doc.getNode(candidate.parent)
      if (!isAutoLayoutFrame(up)) break
      candidate = up
    }
    roots.add(candidate.id)
  }

  // A root under another root is reached by the pass's own recursion.
  const all = [...roots]
  return all.filter((id) => !all.some((other) => other !== id && doc.isAncestorOf(other, id)))
}

/**
 * Lays out `frameId` and every auto layout frame below it, returning what has to change.
 *
 * `exclude` drops children from the flow as if they were invisible. The reorder drag uses it
 * for the node that is following the pointer, so the layout arranges the siblings around the
 * gap instead of snapping the dragged node back into it.
 */
export function computeLayout(
  doc: SceneDocument,
  frameId: NodeId,
  measurer: TextMeasurer,
  exclude?: ReadonlySet<NodeId>,
): LayoutPatch[] {
  const frame = doc.getNode(frameId)
  if (!isAutoLayoutFrame(frame)) return []
  const solver = new Solver(doc, measurer, exclude ?? new Set())
  solver.place(frame, {})
  return solver.patches
}

/** Applies patches with one `update` each. The caller owns the transaction. */
export function applyLayout(doc: SceneDocument, patches: readonly LayoutPatch[]): void {
  for (const patch of patches) {
    const changes: Partial<Omit<TextNode, 'id' | 'type'>> = {}
    if (patch.transform) changes.transform = patch.transform
    if (patch.size) changes.size = patch.size
    if (patch.autoWidth === false) changes.autoWidth = false
    doc.update<TextNode>(patch.id, changes)
  }
}

/**
 * Where a point in the frame's local space would insert among the children.
 *
 * Returned as an index into the children array with `exclude` removed, which is the array
 * `reorder` or `reparent` will splice into once the excluded node is out. A participating
 * child counts as passed once the pointer is beyond its midpoint along the main axis.
 * Invisible children have no position, so they ride with their nearest visible neighbour.
 */
export function insertionIndex(
  doc: SceneDocument,
  frameId: NodeId,
  localPoint: Vec2,
  exclude?: ReadonlySet<NodeId>,
): number {
  const frame = doc.getNode(frameId)
  if (!isAutoLayoutFrame(frame)) return doc.getChildren(frameId).length

  const horizontal = frame.layout.direction === 'horizontal'
  const pointer = horizontal ? localPoint.x : localPoint.y

  let stripped = -1
  let insert = 0
  for (const child of doc.getChildren(frameId)) {
    if (exclude?.has(child.id)) continue
    stripped += 1
    if (!child.visible) continue
    const box = transformRect(child.transform, { x: 0, y: 0, ...child.size })
    const mid = horizontal ? box.x + box.width / 2 : box.y + box.height / 2
    if (pointer > mid) insert = stripped + 1
  }
  return insert
}

/**
 * A layout guessed from where the children already sit, so switching auto layout on does not
 * rearrange anything it does not have to.
 *
 * Direction follows the axis the children are more spread along. Gap is the average of the
 * runs between neighbours, padding is the space between the children and the frame's edges,
 * and both clamp at zero rather than inventing negative values from overlaps. `childOrder`
 * is the children sorted into flow order, which the caller writes back so index order and
 * visual order agree from the first layout.
 */
export function inferLayout(
  doc: SceneDocument,
  frameId: NodeId,
): { layout: FrameLayout; childOrder: NodeId[] } {
  const frame = doc.expectNode(frameId)
  const children = doc.getChildren(frameId)
  const boxed = children.map((child) => ({
    child,
    box: transformRect(child.transform, { x: 0, y: 0, ...child.size }),
  }))
  const visible = boxed.filter(({ child }) => child.visible)

  const spread = (along: (box: Rect) => number): number => {
    const centres = visible.map(({ box }) => along(box))
    return centres.length > 1 ? Math.max(...centres) - Math.min(...centres) : 0
  }
  const horizontal = spread((box) => box.x + box.width / 2) >= spread((box) => box.y + box.height / 2)

  const mainStart = (box: Rect): number => (horizontal ? box.x : box.y)
  const mainEnd = (box: Rect): number => (horizontal ? box.x + box.width : box.y + box.height)
  const mainMid = (box: Rect): number => (mainStart(box) + mainEnd(box)) / 2

  const sorted = [...boxed].sort((a, b) => mainMid(a.box) - mainMid(b.box))

  let gap = 10
  const sortedVisible = sorted.filter(({ child }) => child.visible)
  if (sortedVisible.length > 1) {
    let total = 0
    for (let i = 1; i < sortedVisible.length; i += 1) {
      const previous = sortedVisible[i - 1]
      const current = sortedVisible[i]
      if (previous && current) total += mainStart(current.box) - mainEnd(previous.box)
    }
    gap = Math.max(0, total / (sortedVisible.length - 1))
  }

  const padding = { top: 10, right: 10, bottom: 10, left: 10 }
  if (visible.length > 0) {
    const rects = visible.map(({ box }) => box)
    padding.left = Math.max(0, Math.min(...rects.map((r) => r.x)))
    padding.top = Math.max(0, Math.min(...rects.map((r) => r.y)))
    padding.right = Math.max(0, frame.size.width - Math.max(...rects.map((r) => r.x + r.width)))
    padding.bottom = Math.max(0, frame.size.height - Math.max(...rects.map((r) => r.y + r.height)))
  }

  return {
    layout: {
      direction: horizontal ? 'horizontal' : 'vertical',
      gap,
      padding,
      mainAlign: 'start',
      crossAlign: 'start',
      // Fixed on both axes so the frame's size never jumps at the moment layout is enabled.
      mainSizing: 'fixed',
      crossSizing: 'fixed',
    },
    childOrder: sorted.map(({ child }) => child.id),
  }
}

// The solver ------------------------------------------------------------------------------

type AutoFrame = FrameNode & { layout: FrameLayout }

/** Constraints handed down by the parent, in the node's own width/height terms. */
interface Forced {
  width?: number
  height?: number
}

interface Entry {
  node: SceneNode
  /** Linear part close enough to identity that the node's axes are the frame's axes. */
  plain: boolean
  fillMain: boolean
  fillCross: boolean
  /** Final size in the node's own terms, after every constraint that applies to it. */
  size: Size
  /** The size's bounds under the node's linear transform: the box the flow actually packs. */
  flow: Rect
  /** What place() forwards when the entry is itself an auto layout frame. */
  forced: Forced
}

interface Solved {
  size: Size
  entries: Entry[]
  /** Frame local position of each entry's flow box corner, same order as `entries`. */
  positions: Vec2[]
}

class Solver {
  readonly patches: LayoutPatch[] = []
  readonly #doc: SceneDocument
  readonly #measurer: TextMeasurer
  readonly #exclude: ReadonlySet<NodeId>

  constructor(doc: SceneDocument, measurer: TextMeasurer, exclude: ReadonlySet<NodeId>) {
    this.#doc = doc
    this.#measurer = measurer
    this.#exclude = exclude
  }

  /** Solves the frame, emits its patches, and recurses into its auto layout children. */
  place(frame: AutoFrame, forced: Forced): void {
    const solved = this.#solve(frame, forced)

    if (!near(solved.size.width, frame.size.width) || !near(solved.size.height, frame.size.height)) {
      this.patches.push({ id: frame.id, size: solved.size })
    }

    solved.entries.forEach((entry, index) => {
      const at = solved.positions[index] as Vec2
      const patch: LayoutPatch = { id: entry.node.id }

      // The flow places the bounds; the transform places the origin. For a plain child the
      // two coincide, for a turned one the bounds corner leads the origin by the AABB offset,
      // which `flow` carries as its x and y.
      const tx = at.x - entry.flow.x
      const ty = at.y - entry.flow.y
      if (!near(tx, entry.node.transform.tx) || !near(ty, entry.node.transform.ty)) {
        patch.transform = { ...entry.node.transform, tx, ty }
      }

      if (isAutoLayoutFrame(entry.node)) {
        // Its own place() writes its size, so the recursion and this loop never both do.
        if (patch.transform) this.patches.push(patch)
        this.place(entry.node, entry.forced)
        return
      }

      if (!near(entry.size.width, entry.node.size.width) || !near(entry.size.height, entry.node.size.height)) {
        patch.size = { ...entry.size }
        if (entry.node.type === 'text' && entry.node.autoWidth) patch.autoWidth = false
      }
      if (patch.transform || patch.size) this.patches.push(patch)
    })
  }

  /**
   * The final size of a node under the given constraints, without emitting anything.
   *
   * For an auto layout frame this solves it outright, so a hug axis reflects what the
   * children will actually occupy once every constraint has landed, not what they occupy
   * now. For text a forced width is a wrap width, and the height follows from it.
   */
  #resolveSize(node: SceneNode, forced: Forced): Size {
    if (isAutoLayoutFrame(node)) return this.#solve(node, forced).size
    if (node.type === 'text' && forced.width !== undefined) {
      const measured = this.#measurer.measure(node, forced.width)
      return { width: forced.width, height: measured ? measured.height : node.size.height }
    }
    return {
      width: forced.width ?? node.size.width,
      height: forced.height ?? node.size.height,
    }
  }

  #solve(frame: AutoFrame, forced: Forced): Solved {
    const layout = frame.layout
    const horizontal = layout.direction === 'horizontal'
    const pad = layout.padding
    const padMainStart = horizontal ? pad.left : pad.top
    const padMainEnd = horizontal ? pad.right : pad.bottom
    const padCrossStart = horizontal ? pad.top : pad.left
    const padCrossEnd = horizontal ? pad.bottom : pad.right

    const mainOf = (size: { width: number; height: number }): number =>
      horizontal ? size.width : size.height
    const crossOf = (size: { width: number; height: number }): number =>
      horizontal ? size.height : size.width
    const asForced = (main: number | undefined, cross: number | undefined): Forced => {
      const result: Forced = {}
      if (horizontal) {
        if (main !== undefined) result.width = main
        if (cross !== undefined) result.height = cross
      } else {
        if (main !== undefined) result.height = main
        if (cross !== undefined) result.width = cross
      }
      return result
    }

    const forcedMain = horizontal ? forced.width : forced.height
    const forcedCross = horizontal ? forced.height : forced.width

    // A known axis is one whose extent does not depend on the children. Fill only stretches
    // into a known axis; against a hug axis it degenerates to fixed, because a child sized
    // by the frame while the frame is sized by the child is a loop with no answer.
    const knownMain = forcedMain ?? (layout.mainSizing === 'fixed' ? mainOf(frame.size) : undefined)
    const knownCross = forcedCross ?? (layout.crossSizing === 'fixed' ? crossOf(frame.size) : undefined)

    const children = this.#doc
      .getChildren(frame.id)
      .filter((child) => child.visible && !this.#exclude.has(child.id))
    const gaps = layout.gap * Math.max(0, children.length - 1)

    const entries: Entry[] = children.map((node) => {
      const t = node.transform
      // Absolute value on a and d, not just b and c pinned at zero: a flip is a negative a or
      // d with no rotation or skew of its own, and a flipped child should still be eligible to
      // fill its parent rather than silently losing fill sizing because of the sign.
      const plain = near(Math.abs(t.a), 1) && near(t.b, 0) && near(t.c, 0) && near(Math.abs(t.d), 1)
      const mode = node.layoutChild
      // Text height is measured from the text, so it is never anyone's to fill.
      const fillWidth = plain && mode?.widthMode === 'fill'
      const fillHeight = plain && mode?.heightMode === 'fill' && node.type !== 'text'
      return {
        node,
        plain,
        fillMain: (horizontal ? fillWidth : fillHeight) && knownMain !== undefined,
        fillCross: (horizontal ? fillHeight : fillWidth) && knownCross !== undefined,
        size: { ...node.size },
        flow: { x: 0, y: 0, ...node.size },
        forced: {},
      }
    })

    const resolve = (entry: Entry, main: number | undefined, cross: number | undefined): void => {
      entry.forced = asForced(main, cross)
      entry.size = this.#resolveSize(entry.node, entry.forced)
      entry.flow = transformRect(
        { ...entry.node.transform, tx: 0, ty: 0 },
        { x: 0, y: 0, ...entry.size },
      )
    }

    // Everything except a main share is known per child up front, so each child that is not
    // waiting on one resolves exactly once, with its final constraints.
    const crossExtent = knownCross !== undefined
      ? Math.max(0, knownCross - padCrossStart - padCrossEnd)
      : undefined
    for (const entry of entries) {
      if (entry.fillMain) continue
      resolve(entry, undefined, entry.fillCross ? crossExtent : undefined)
    }

    const frameMain = knownMain ?? padMainStart + padMainEnd + gaps
      + entries.reduce((sum, entry) => sum + mainOf(entry.flow), 0)

    const fillers = entries.filter((entry) => entry.fillMain)
    if (fillers.length > 0) {
      const taken = entries.reduce(
        (sum, entry) => (entry.fillMain ? sum : sum + mainOf(entry.flow)),
        0,
      )
      const share = Math.max(
        0,
        (frameMain - padMainStart - padMainEnd - gaps - taken) / fillers.length,
      )
      for (const entry of fillers) {
        resolve(entry, share, entry.fillCross ? crossExtent : undefined)
      }
    }

    const frameCross = knownCross ?? padCrossStart + padCrossEnd
      + entries.reduce((max, entry) => Math.max(max, crossOf(entry.flow)), 0)

    // Alignment only has room to work when no fill child absorbed the slack.
    const used = gaps + entries.reduce((sum, entry) => sum + mainOf(entry.flow), 0)
    const free = Math.max(0, frameMain - padMainStart - padMainEnd - used)
    let cursor = padMainStart
    let extraGap = 0
    if (layout.mainAlign === 'center') cursor += free / 2
    else if (layout.mainAlign === 'end') cursor += free
    else if (layout.mainAlign === 'space-between' && entries.length > 1) {
      extraGap = free / (entries.length - 1)
    }

    const positions: Vec2[] = []
    const crossRoom = frameCross - padCrossStart - padCrossEnd
    for (const entry of entries) {
      let crossAt = padCrossStart
      if (layout.crossAlign === 'center') crossAt += (crossRoom - crossOf(entry.flow)) / 2
      else if (layout.crossAlign === 'end') crossAt += crossRoom - crossOf(entry.flow)
      positions.push(horizontal ? { x: cursor, y: crossAt } : { x: crossAt, y: cursor })
      cursor += mainOf(entry.flow) + layout.gap + extraGap
    }

    return {
      size: horizontal
        ? { width: frameMain, height: frameCross }
        : { width: frameCross, height: frameMain },
      entries,
      positions,
    }
  }
}
