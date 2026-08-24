import type { NodeId, SceneDocument } from '@canvas/document'
import { relayout } from './autoLayout'

/**
 * Z-order commands.
 *
 * Index 0 is the back of the stack, because that is the order the instance buffer is packed
 * in and therefore the order things are painted. "Forward" means later in the array.
 *
 * The document only offers `reorder` to an index. Turning that into the four commands people
 * actually reach for belongs up here, not in the scene model.
 */
export type OrderCommand = 'forward' | 'backward' | 'front' | 'back'

export function reorderSelection(
  scene: SceneDocument,
  selection: readonly NodeId[],
  command: OrderCommand,
): void {
  if (selection.length === 0) return

  scene.transact(() => {
    /*
     * Every move shifts the indices of the nodes not yet moved, so the order they are applied
     * in decides whether a multiple selection survives intact. The two failure modes differ:
     *
     *   forward  ascending  -> each node lands where the previous one just left, no movement
     *   back     ascending  -> the selection comes out reversed
     *
     * A step and a jump therefore want opposite directions. Stepping forward and jumping to
     * the back both start from the node nearest that end.
     */
    const ascending = [...selection].sort((a, b) => scene.indexOf(a) - scene.indexOf(b))
    const sequence =
      command === 'forward' || command === 'back' ? [...ascending].reverse() : ascending

    for (const id of sequence) {
      const node = scene.getNode(id)
      if (!node?.parent) continue
      const siblings = scene.expectNode(node.parent).children.length
      const index = scene.indexOf(id)

      switch (command) {
        case 'forward':
          scene.reorder(id, index + 1)
          break
        case 'backward':
          scene.reorder(id, index - 1)
          break
        case 'front':
          scene.reorder(id, siblings - 1)
          break
        case 'back':
          scene.reorder(id, 0)
          break
      }
    }

    // In an auto layout frame paint order and flow order are the same array, so a z-order
    // command is also a move.
    relayout(scene, selection)
  })
}
