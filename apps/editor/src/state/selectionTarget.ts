import type { NodeId, SceneDocument } from '@canvas/document'

/**
 * Which node a click actually selects, given what the pointer landed on.
 *
 * `hitTest` answers a geometry question and deliberately returns the deepest node under the
 * cursor. What you select from that is a UI policy, so it lives up here, the same way the
 * z-order commands sit above the document's `reorder`.
 *
 * The policy is Figma's. A click selects the outermost container the hit sits in rather than
 * the shape itself, so a button made of a frame, a rectangle and a label is one thing to
 * click and drag. Two ways in go with it, both in `pointerInput`: Cmd reaches the deepest
 * node in one click, and a double click descends one level.
 *
 * A top-level frame is the exception, and it is the whole reason this is not a one line walk
 * to the root. Frames directly under the page are artboards: they hold everything on the
 * canvas, so letting one swallow its own clicks would mean every selection started with a
 * Cmd. Selection therefore stops one level inside them.
 */

/** The container clicks resolve inside. `null` is the page, which is to say nothing entered. */
export type SelectionContext = NodeId | null

export interface SelectionResolution {
  /** The node to select. */
  id: NodeId
  /** The container the selection now sits in, which the next click resolves against. */
  context: SelectionContext
}

/** From a node up to the page: `[id, parent, ..., rootId]`. */
function chainToRoot(document: SceneDocument, id: NodeId): NodeId[] {
  const chain: NodeId[] = []
  let current: NodeId | undefined = id
  while (current) {
    chain.push(current)
    if (current === document.rootId) break
    current = document.getNode(current)?.parent ?? undefined
  }
  return chain
}

/**
 * What a plain click on `hit` selects, and where that leaves the context.
 *
 * An entered context wins when the hit is inside it: the click picks that container's own
 * child, which is what keeps clicks at the level you stepped into instead of throwing you
 * back out on the first sibling. A context that no longer contains the hit is stale, whether
 * the node was deleted or the click simply landed elsewhere, and resolving falls back to the
 * default as if nothing had been entered.
 */
export function selectionTarget(
  document: SceneDocument,
  hit: NodeId,
  context: SelectionContext,
): SelectionResolution {
  const chain = chainToRoot(document, hit)

  // The page is not an entered context, it is the absence of one. Treating it as entered
  // would select the top-level frame and take the artboard rule with it.
  if (context && context !== document.rootId) {
    const inside = chain.indexOf(context)
    // Strictly above the hit: a click on the entered container itself is not a click inside
    // it, and resolving it below is what steps the context back out by one.
    if (inside > 0) {
      return { id: chain[inside - 1] as NodeId, context }
    }
  }

  // Nothing entered: stop one level inside the top-level frame, or take the hit itself when
  // it is top-level already and there is no level to stop short of.
  const underPage = chain[chain.length - 1] === document.rootId ? chain.slice(0, -1) : chain
  if (underPage.length <= 1) {
    return { id: hit, context: null }
  }
  return {
    id: underPage[underPage.length - 2] as NodeId,
    context: underPage[underPage.length - 1] as NodeId,
  }
}

/**
 * The deepest node under the cursor, which is what Cmd asks for.
 *
 * The context follows it down, so the clicks after a deep select stay at the level it
 * reached rather than springing back out.
 */
export function deepSelectionTarget(
  document: SceneDocument,
  hit: NodeId,
): SelectionResolution {
  const parent = document.getNode(hit)?.parent ?? null
  return { id: hit, context: parent === document.rootId ? null : parent }
}

/**
 * One level further in than a plain click would go, which is what a double click asks for.
 *
 * Null when there is nothing left to descend into, so the caller can fall through to what a
 * double click means at the bottom: opening a text node for editing.
 */
export function descendSelectionTarget(
  document: SceneDocument,
  hit: NodeId,
  context: SelectionContext,
): SelectionResolution | null {
  const resolved = selectionTarget(document, hit, context)
  if (resolved.id === hit) return null
  return selectionTarget(document, hit, resolved.id)
}
