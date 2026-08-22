import {
  instantiateSubtree,
  serializeSubtree,
  type NodeId,
  type SceneDocument,
  type SceneNode,
  type Vec2,
} from '@figma-canvas/document'
import { relayout } from './autoLayout'

/**
 * Copies nodes next to themselves and returns the copies.
 *
 * Shared by Cmd+D and by option drag, which differ only in the offset: Cmd+D nudges the copy
 * so it is visible, option drag leaves it exactly on top because the drag itself moves it.
 */
export function duplicateNodes(
  scene: SceneDocument,
  ids: readonly NodeId[],
  offset: Vec2,
): SceneNode[] {
  const subtree = serializeSubtree(scene, ids)
  if (subtree.nodes.length === 0) return []

  const firstRoot = subtree.roots[0]
  const parent = (firstRoot ? scene.getNode(firstRoot)?.parent : null) ?? scene.rootId
  return scene.transact(() => {
    const created = instantiateSubtree(scene, subtree, parent, offset)
    // A copy dropped into an auto layout frame joins the flow immediately.
    relayout(scene, created.map((node) => node.id))
    return created
  })
}
