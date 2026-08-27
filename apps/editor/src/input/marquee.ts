import type { NodeId } from '@canvas/document'

/**
 * What the rubber band selects as it sweeps. The base is whatever was selected when the
 * marquee started, kept so shift extends it, matching shift clicking.
 */
export function mergeMarqueeSelection(
  base: readonly NodeId[],
  caught: readonly NodeId[],
): NodeId[] {
  return [...base, ...caught.filter((id) => !base.includes(id))]
}

/**
 * Whether the sweep actually changed the selection. Selection lives in React state, and
 * writing it on every frame of the rubber band would re-render the layers tree sixty times a
 * second to arrive at the same list.
 */
export function selectionChanged(
  next: readonly NodeId[],
  current: readonly NodeId[],
): boolean {
  return next.length !== current.length || next.some((id, index) => id !== current[index])
}
