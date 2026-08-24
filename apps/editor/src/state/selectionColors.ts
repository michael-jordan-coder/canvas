import {
  drawnPaints,
  drawnStrokes,
  isPainted,
  toHex,
  type NodeId,
  type SceneDocument,
} from '@canvas/document'

/** One colour found somewhere in the selection, and how many paints drew it. */
export interface ColorTally {
  hex: string
  count: number
}

/**
 * Roots only, the same collapse `wrapInAutoLayout` and `instantiateSubtree` apply: a frame
 * selected together with its own child would otherwise have that child's paints walked and
 * counted twice, once under the frame's own subtree and once for itself.
 */
function selectionRoots(scene: SceneDocument, selection: readonly NodeId[]): NodeId[] {
  const selected = new Set(selection)
  const hasSelectedAncestor = (id: NodeId): boolean => {
    let current = scene.getNode(id)
    while (current?.parent) {
      if (selected.has(current.parent)) return true
      current = scene.getNode(current.parent)
    }
    return false
  }
  return selection.filter((id) => scene.getNode(id) && !hasSelectedAncestor(id))
}

/**
 * Every colour drawn anywhere in the selection's subtrees, most used first.
 *
 * Keyed by hex rather than by paint, so a fill and a stroke of the same colour on different
 * nodes count as one swatch with a count of two. `drawnPaints`/`drawnStrokes` are the same
 * functions the renderer packs instances from, so a hidden paint is excluded here exactly as
 * it is excluded from the screen.
 */
export function tallySelectionColors(
  scene: SceneDocument,
  selection: readonly NodeId[],
): ColorTally[] {
  const counts = new Map<string, number>()
  const bump = (hex: string): void => {
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }

  for (const rootId of selectionRoots(scene, selection)) {
    for (const node of scene.walk(rootId)) {
      if (!isPainted(node)) continue
      for (const paint of drawnPaints(node.fills)) bump(toHex(paint.color))
      for (const stroke of drawnStrokes(node.strokes)) bump(toHex(stroke.paint.color))
    }
  }

  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
}
