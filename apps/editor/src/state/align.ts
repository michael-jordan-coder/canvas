import {
  invert,
  isAutoLayoutFrame,
  multiply,
  transformRect,
  translation,
  type Mat2D,
  type NodeId,
  type Rect,
  type SceneDocument,
} from '@canvas/document'
import { selectionWorldBounds } from '@canvas/renderer'
import { relayout } from './autoLayout'

/**
 * Align and distribute, built the same way the z-order commands are: the scene model has
 * nothing to say about "align left", only about a node's transform, so turning one into the
 * other belongs up here.
 */
export type AlignCommand =
  | 'left'
  | 'centerX'
  | 'right'
  | 'top'
  | 'centerY'
  | 'bottom'
  | 'distributeHorizontal'
  | 'distributeVertical'

const IDENTITY_MATRIX: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

export function alignSelection(
  scene: SceneDocument,
  selection: readonly NodeId[],
  command: AlignCommand,
): void {
  if (selection.length === 0) return

  scene.transact(() => {
    const box = referenceBox(scene, selection)
    const movable = selection.filter((id) => canMove(scene, id))

    if (box && movable.length > 0) {
      if (command === 'distributeHorizontal' || command === 'distributeVertical') {
        distribute(scene, movable, command)
      } else {
        for (const id of movable) alignOne(scene, id, box, command)
      }
    }

    // In an auto layout frame, alignment is a no-op for the child it touches (the layout owns
    // its position and would put it straight back), but a sibling's box can still have moved
    // the frame's hug size, so the walk still has to happen.
    relayout(scene, selection)
  })
}

/**
 * What the selection aligns against.
 *
 * A single node aligns to its parent's box, which is Figma's rule: pick one thing inside a
 * frame and align it within the frame. The page is not a frame, it has no bounds of its own,
 * so a lone top level node falls through to its own box, which is a no-op, the same as Figma
 * offering nothing to align a single ungrouped object against. Two or more nodes always align
 * to their own union, wherever they happen to live.
 */
function referenceBox(scene: SceneDocument, selection: readonly NodeId[]): Rect | null {
  const only = selection.length === 1 ? selection[0] : undefined
  if (only) {
    const node = scene.getNode(only)
    const parent = node?.parent ? scene.getNode(node.parent) : undefined
    if (parent?.type === 'frame') {
      return transformRect(scene.worldTransform(parent.id), { x: 0, y: 0, ...parent.size })
    }
  }
  return selectionWorldBounds(scene, selection)
}

/**
 * A node is skipped, not aligned, when it is locked or when its parent lays it out. A child
 * of an auto layout frame sits where the layout puts it; moving it here would be undone the
 * moment `relayout` runs at the end of the same transaction, so it is left alone rather than
 * fought over.
 */
function canMove(scene: SceneDocument, id: NodeId): boolean {
  const node = scene.getNode(id)
  if (!node || node.locked) return false
  const parent = node.parent ? scene.getNode(node.parent) : undefined
  return !isAutoLayoutFrame(parent)
}

function worldBoxOf(scene: SceneDocument, id: NodeId): Rect {
  const node = scene.expectNode(id)
  return transformRect(scene.worldTransform(id), { x: 0, y: 0, ...node.size })
}

/**
 * Moves one node by a world space offset, composing exactly the way `rotateNodes` composes a
 * turn: the node's own world transform, then the offset (which is already in world units and
 * so needs no further mapping), then back out of the parent's space into local units. Going
 * through world rather than nudging the local transform directly is what keeps this correct
 * for a node inside a rotated or scaled frame.
 */
function moveWorld(scene: SceneDocument, id: NodeId, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return
  const node = scene.expectNode(id)
  const world = scene.worldTransform(id)
  const parentWorld = node.parent ? scene.worldTransform(node.parent) : IDENTITY_MATRIX
  scene.update(id, { transform: multiply(multiply(world, translation(dx, dy)), invert(parentWorld)) })
}

type EdgeCommand = Exclude<AlignCommand, 'distributeHorizontal' | 'distributeVertical'>

function alignOne(scene: SceneDocument, id: NodeId, box: Rect, command: EdgeCommand): void {
  const nodeBox = worldBoxOf(scene, id)
  let dx = 0
  let dy = 0
  switch (command) {
    case 'left':
      dx = box.x - nodeBox.x
      break
    case 'centerX':
      dx = box.x + box.width / 2 - (nodeBox.x + nodeBox.width / 2)
      break
    case 'right':
      dx = box.x + box.width - (nodeBox.x + nodeBox.width)
      break
    case 'top':
      dy = box.y - nodeBox.y
      break
    case 'centerY':
      dy = box.y + box.height / 2 - (nodeBox.y + nodeBox.height / 2)
      break
    case 'bottom':
      dy = box.y + box.height - (nodeBox.y + nodeBox.height)
      break
  }
  moveWorld(scene, id, dx, dy)
}

/**
 * Equalises the gaps between the selection's boxes along one axis, holding the two extremes
 * fixed: the first node's leading edge and the last node's trailing edge do not move, only
 * what sits between them redistributes. Needs three or more nodes, since two boxes have
 * exactly one gap and "equalising" one gap changes nothing, and one box has nothing to
 * distribute against.
 */
function distribute(
  scene: SceneDocument,
  ids: readonly NodeId[],
  command: 'distributeHorizontal' | 'distributeVertical',
): void {
  if (ids.length < 3) return

  const horizontal = command === 'distributeHorizontal'
  const start = (box: Rect): number => (horizontal ? box.x : box.y)
  const extent = (box: Rect): number => (horizontal ? box.width : box.height)

  const boxed = ids
    .map((id) => ({ id, box: worldBoxOf(scene, id) }))
    .sort((a, b) => start(a.box) - start(b.box))

  const first = boxed[0]
  const last = boxed[boxed.length - 1]
  if (!first || !last) return

  const span = start(last.box) + extent(last.box) - start(first.box)
  const sizeSum = boxed.reduce((sum, { box }) => sum + extent(box), 0)
  const gap = (span - sizeSum) / (boxed.length - 1)

  let cursor = start(first.box)
  for (const { id, box } of boxed) {
    const delta = cursor - start(box)
    if (horizontal) moveWorld(scene, id, delta, 0)
    else moveWorld(scene, id, 0, delta)
    cursor += extent(box) + gap
  }
}
