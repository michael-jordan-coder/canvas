import { describe, expect, it } from 'vitest'
import { SceneDocument, createRectangle } from '@figma-canvas/document'
import { reorderSelection } from './order'

function stack() {
  const scene = new SceneDocument()
  const a = scene.insert(createRectangle({ name: 'a' }))
  const b = scene.insert(createRectangle({ name: 'b' }))
  const c = scene.insert(createRectangle({ name: 'c' }))
  const d = scene.insert(createRectangle({ name: 'd' }))
  scene.clearHistory()
  return { scene, a, b, c, d }
}

const order = (scene: SceneDocument): string[] =>
  scene.getChildren(scene.rootId).map((node) => node.name)

describe('reorderSelection', () => {
  it('steps one node forward and backward', () => {
    const { scene, a } = stack()
    reorderSelection(scene, [a.id], 'forward')
    expect(order(scene)).toEqual(['b', 'a', 'c', 'd'])
    reorderSelection(scene, [a.id], 'backward')
    expect(order(scene)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sends a node to the front and to the back', () => {
    const { scene, a, d } = stack()
    reorderSelection(scene, [a.id], 'front')
    expect(order(scene)).toEqual(['b', 'c', 'd', 'a'])
    reorderSelection(scene, [d.id], 'back')
    expect(order(scene)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('does nothing at the ends', () => {
    const { scene, a, d } = stack()
    reorderSelection(scene, [a.id], 'backward')
    reorderSelection(scene, [d.id], 'forward')
    expect(order(scene)).toEqual(['a', 'b', 'c', 'd'])
  })

  /*
   * The order the moves are applied in matters. Each one shifts the indices of the nodes not
   * yet moved, so applying them the wrong way round makes a multiple selection collapse onto
   * itself or come out reversed.
   */
  it('moves a multiple selection forward without collapsing it', () => {
    const { scene, a, b } = stack()
    reorderSelection(scene, [a.id, b.id], 'forward')
    expect(order(scene)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('moves a multiple selection backward without collapsing it', () => {
    const { scene, c, d } = stack()
    reorderSelection(scene, [c.id, d.id], 'backward')
    expect(order(scene)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('keeps relative order when sending several to the front', () => {
    const { scene, a, b } = stack()
    reorderSelection(scene, [a.id, b.id], 'front')
    expect(order(scene)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('keeps relative order when sending several to the back', () => {
    const { scene, c, d } = stack()
    reorderSelection(scene, [c.id, d.id], 'back')
    expect(order(scene)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('is unaffected by the order the selection happens to be listed in', () => {
    const { scene, a, b } = stack()
    reorderSelection(scene, [b.id, a.id], 'front')
    expect(order(scene)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('is one undo step for the whole selection', () => {
    const { scene, a, b } = stack()
    reorderSelection(scene, [a.id, b.id], 'front')
    expect(scene.historyDepth).toBe(1)
    scene.undo()
    expect(order(scene)).toEqual(['a', 'b', 'c', 'd'])
  })
})
