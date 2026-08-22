import {
  createComponent,
  insertionIndex,
  isAutoLayoutFrame,
  translation,
  type ComponentNode,
  type ComponentPropValue,
  type NodeId,
  type SceneDocument,
  type Size,
  type Vec2,
} from '@figma-canvas/document'
import { measureComponentNode, measureComponentSize } from '../components/measure'
import { componentSpec, defaultProps, type ComponentSpec } from '../components/registry'
import { relayout } from './autoLayout'

/**
 * Every edit to a component node, in one place, for the reason `updateText` exists: a
 * component's `size` is a cache of what its component renders, so whatever writes the props
 * writes the size in the same transaction. A step that restored one without the other would
 * leave a component you can see in one place and click in another.
 *
 * Nothing in here knows what React is. It measures through `components/measure`, which does,
 * and writes plain numbers to the document, which does not.
 */

/** The size a fresh instance is created at, or the spec's fallback where there is no DOM. */
function initialSize(spec: ComponentSpec, props: Record<string, ComponentPropValue>): Size {
  return measureComponentSize(spec, props, spec.defaultWidth) ?? spec.fallbackSize
}

/**
 * Drops a new instance of `spec` into `parentId` at a point in that parent's own space.
 *
 * The two parents behave differently on purpose. A plain frame is positional, so the
 * component lands centred on where it was dropped. An auto layout frame is not: dropping
 * into one is asking for a place in the flow, so the point becomes an index and the layout
 * decides the coordinates. Writing a transform there would be inventing a position the very
 * next layout pass overwrites, and it is the difference between a component that joins a
 * stack and one that merely lands on top of it.
 *
 * One transaction, so the insert, the placement and the layout it disturbs are one undo step.
 */
export function insertComponent(
  document: SceneDocument,
  spec: ComponentSpec,
  parentId: NodeId,
  point: Vec2,
): ComponentNode {
  const props = defaultProps(spec)
  const size = initialSize(spec, props)
  const node = createComponent({ name: spec.name, component: spec.key, props, size })

  const flowed = isAutoLayoutFrame(document.getNode(parentId))
  const index = flowed ? insertionIndex(document, parentId, point) : undefined

  document.transact(() => {
    document.insert(node, parentId, index)
    if (!flowed) {
      // Centred on the drop point, which is where the pointer was and therefore where the
      // preview rectangle was drawn.
      document.update<ComponentNode>(node.id, {
        transform: translation(point.x - size.width / 2, point.y - size.height / 2),
      })
    }
    relayout(document, [node.id])
  })

  return node
}

/**
 * Changes a component's props and rewrites its measured size in the same update.
 *
 * The panel calls this on every commit, so a longer label grows the box, the selection
 * outline follows it, and the click target follows both. That is the whole reason the size
 * is measured rather than left as whatever it was when the component was dropped.
 */
export function updateComponentProps(
  document: SceneDocument,
  node: ComponentNode,
  changes: Record<string, ComponentPropValue>,
): void {
  const props = { ...node.props, ...changes }
  const size = measureComponentNode(node, { props })
  document.transact(() => {
    document.update<ComponentNode>(node.id, size ? { props, size } : { props })
    relayout(document, [node.id])
  })
}

/**
 * Hands the box back to the component, or takes it away.
 *
 * Turning it on remeasures at once, because the point of the toggle is to undo a resize, and
 * a box that stayed where the drag left it would make the switch look like it did nothing.
 */
export function setComponentAutoSize(
  document: SceneDocument,
  node: ComponentNode,
  autoSize: boolean,
): void {
  const size = autoSize ? measureComponentNode(node, { autoSize: true }) : null
  document.transact(() => {
    document.update<ComponentNode>(node.id, size ? { autoSize, size } : { autoSize })
    relayout(document, [node.id])
  })
}

/**
 * Measures every auto sized component in the document and writes back what changed.
 *
 * The same job `remeasureAll` does for text and for the same reason: a saved file loads
 * synchronously and carries the sizes the components rendered at when they were saved, which
 * a change to a component's own CSS quietly invalidates. Measuring is not an edit, so the
 * caller clears history afterwards.
 */
export function remeasureComponents(document: SceneDocument): void {
  const stale: { id: NodeId; size: Size }[] = []
  for (const node of document.walk()) {
    if (node.type !== 'component') continue
    const size = measureComponentNode(node)
    if (!size) continue
    if (size.width !== node.size.width || size.height !== node.size.height) {
      stale.push({ id: node.id, size })
    }
  }
  if (stale.length === 0) return

  document.transact(() => {
    for (const { id, size } of stale) document.update<ComponentNode>(id, { size })
    relayout(
      document,
      stale.map(({ id }) => id),
    )
  })
}

/**
 * How auto layout measures a component child it is about to hand a width, and the component
 * half of the measurer registered in `state/measure.ts`.
 *
 * A component that has been resized by hand is not measured at all: its box is the setting
 * from that point on, so the layout gets null and keeps it.
 */
export function measureComponentInLayout(node: ComponentNode, width: number): Size | null {
  if (!node.autoSize) return null
  const spec = componentSpec(node.component)
  if (!spec) return null
  return measureComponentSize(spec, node.props, width)
}
