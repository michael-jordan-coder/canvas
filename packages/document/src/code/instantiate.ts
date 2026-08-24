import type { SceneDocument } from '../document.js'
import { transformRect, translation, type Rect, type Size } from '../math.js'
import {
  createEllipse,
  createFrame,
  createRectangle,
  createText,
  type FrameLayout,
  type LayoutChild,
  type NodeId,
  type SceneNode,
  type TextNode,
} from '../node.js'
import { fromHex, type Paint, type Stroke } from '../paint.js'
import { uniformCornerRadii, type CornerRadii } from '../sdf.js'
import type { CodeElement, CodeElementProps } from './element.js'

/**
 * Turns a validated code tree into real children of the code node, reconciling against what
 * the previous run left there rather than replacing it.
 *
 * Identity is the element's key path against the node's `sourceKey`. Where they match the
 * node is kept and patched with only the fields that differ, so a settled re-run touches
 * nothing: no version bump, no history step, no instance-buffer rebuild, the same idempotence
 * contract the auto layout engine keeps and for the same reasons. Everything goes through the
 * document's own primitives, so history snapshots, change notification and undo need no case
 * for any of this.
 */

/** The editor's bridge to the text cache; this package cannot measure a string itself. */
export type MeasureText = (node: TextNode) => Size | null

/** Below this a numeric difference is noise, not an edit. Matches the layout engine's. */
const EPSILON = 0.01

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON
}

// Prop mapping ---------------------------------------------------------------------------

function fillsOf(hex: string | undefined): Paint[] {
  return hex === undefined ? [] : [fromHex(hex)]
}

/**
 * A border is one inside stroke, because that is what a CSS border is: it takes room from
 * the box rather than growing it.
 */
function strokesOf(props: CodeElementProps): Stroke[] {
  if (props.borderColor === undefined || props.borderWidth === undefined) return []
  if (props.borderWidth <= 0) return []
  return [{ paint: fromHex(props.borderColor), weight: props.borderWidth, align: 'inside' }]
}

function cornerRadiiOf(props: CodeElementProps): CornerRadii {
  const radius = props.borderRadius
  if (radius === undefined) return uniformCornerRadii()
  if (typeof radius === 'number') return uniformCornerRadii(radius)
  return { ...radius }
}

function paddingOf(props: CodeElementProps): FrameLayout['padding'] {
  const padding = props.padding ?? 0
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding }
  }
  return { ...padding }
}

function hasFlexProps(props: CodeElementProps): boolean {
  return (
    props.direction !== undefined ||
    props.gap !== undefined ||
    props.padding !== undefined ||
    props.align !== undefined ||
    props.justify !== undefined
  )
}

/**
 * The flex props as a `FrameLayout`, or undefined for a plain frame. An axis with no given
 * size hugs, which is exactly a flex container sizing to its content when no width is set.
 */
function layoutOf(props: CodeElementProps): FrameLayout | undefined {
  if (!hasFlexProps(props)) return undefined
  const direction = props.direction ?? 'row'
  const horizontal = direction === 'row'
  const mainSize = horizontal ? props.width : props.height
  const crossSize = horizontal ? props.height : props.width
  return {
    direction: horizontal ? 'horizontal' : 'vertical',
    gap: props.gap ?? 0,
    padding: paddingOf(props),
    mainAlign: props.justify ?? 'start',
    crossAlign: props.align ?? 'start',
    mainSizing: mainSize === undefined ? 'hug' : 'fixed',
    crossSizing: crossSize === undefined ? 'hug' : 'fixed',
  }
}

/**
 * `grow` claims the parent's main axis. Stored per node axis the way `LayoutChild` demands,
 * so which dimension it names depends on the direction of the parent it sits in.
 */
function layoutChildOf(
  props: CodeElementProps,
  parentLayout: FrameLayout | undefined,
): LayoutChild | undefined {
  if (!props.grow || !parentLayout) return undefined
  const horizontal = parentLayout.direction === 'horizontal'
  return {
    widthMode: horizontal ? 'fill' : 'fixed',
    heightMode: horizontal ? 'fixed' : 'fill',
  }
}

function nameOf(element: CodeElement): string {
  if (element.name) return element.name
  if (element.key) return element.key
  return element.type.charAt(0).toUpperCase() + element.type.slice(1)
}

/** What the element says the node's fields should be. Size may be refined by layout later. */
interface Desired {
  name: string
  transform: { tx: number; ty: number }
  size: Size
  opacity: number
  fills: Paint[]
  strokes: Stroke[]
  cornerRadii: CornerRadii | null
  clipsContent: boolean
  layout: FrameLayout | undefined
  layoutChild: LayoutChild | undefined
  text: { characters: string; fontSize: number; autoWidth: boolean } | null
}

function desiredOf(element: CodeElement, parentLayout: FrameLayout | undefined): Desired {
  const props = element.props
  const isText = element.type === 'text'
  return {
    name: nameOf(element),
    transform: { tx: props.x ?? 0, ty: props.y ?? 0 },
    size: { width: props.width ?? 0, height: props.height ?? 0 },
    opacity: props.opacity ?? 1,
    fills: isText ? fillsOf(props.color ?? '#000000') : fillsOf(props.background),
    strokes: strokesOf(props),
    cornerRadii:
      element.type === 'frame' || element.type === 'rectangle' ? cornerRadiiOf(props) : null,
    clipsContent: props.overflow === 'hidden',
    layout: element.type === 'frame' ? layoutOf(props) : undefined,
    layoutChild: layoutChildOf(props, parentLayout),
    text: isText
      ? {
          characters: element.text ?? '',
          fontSize: props.fontSize ?? 16,
          autoWidth: props.width === undefined,
        }
      : null,
  }
}

// Reconciliation -------------------------------------------------------------------------

function sameRadii(a: CornerRadii, b: CornerRadii): boolean {
  return (
    near(a.topLeft, b.topLeft) &&
    near(a.topRight, b.topRight) &&
    near(a.bottomRight, b.bottomRight) &&
    near(a.bottomLeft, b.bottomLeft)
  )
}

function samePaints(a: readonly Paint[], b: readonly Paint[]): boolean {
  if (a.length !== b.length) return false
  return a.every((paint, index) => {
    const other = b[index]
    if (!other) return false
    return (
      near(paint.color.r, other.color.r) &&
      near(paint.color.g, other.color.g) &&
      near(paint.color.b, other.color.b) &&
      near(paint.color.a, other.color.a) &&
      (paint.opacity ?? 1) === (other.opacity ?? 1) &&
      (paint.visible ?? true) === (other.visible ?? true)
    )
  })
}

function sameStrokes(a: readonly Stroke[], b: readonly Stroke[]): boolean {
  if (a.length !== b.length) return false
  return a.every((stroke, index) => {
    const other = b[index]
    if (!other) return false
    return (
      near(stroke.weight, other.weight) &&
      stroke.align === other.align &&
      samePaints([stroke.paint], [other.paint])
    )
  })
}

function sameLayout(a: FrameLayout | undefined, b: FrameLayout | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return (
    a.direction === b.direction &&
    near(a.gap, b.gap) &&
    near(a.padding.top, b.padding.top) &&
    near(a.padding.right, b.padding.right) &&
    near(a.padding.bottom, b.padding.bottom) &&
    near(a.padding.left, b.padding.left) &&
    a.mainAlign === b.mainAlign &&
    a.crossAlign === b.crossAlign &&
    a.mainSizing === b.mainSizing &&
    a.crossSizing === b.crossSizing
  )
}

function sameLayoutChild(a: LayoutChild | undefined, b: LayoutChild | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.widthMode === b.widthMode && a.heightMode === b.heightMode
}

/**
 * The patch that brings `node` to `desired`, or null when nothing differs. Null is the
 * point: `document.update` on an identical patch would still bump the version and rebuild
 * the instance buffer, and a settled re-run must cost nothing.
 */
function patchFor(node: SceneNode, desired: Desired): Partial<SceneNode> | null {
  const patch: Record<string, unknown> = {}

  if (node.name !== desired.name) patch['name'] = desired.name
  if (!near(node.opacity, desired.opacity)) patch['opacity'] = desired.opacity
  if (
    !near(node.transform.tx, desired.transform.tx) ||
    !near(node.transform.ty, desired.transform.ty)
  ) {
    patch['transform'] = translation(desired.transform.tx, desired.transform.ty)
  }

  // A hug axis and a measured text box own their size; writing 0 over it would fight the
  // layout every run. Only a size the element actually stated is compared.
  const sizedWidth = desired.text ? !desired.text.autoWidth : desired.size.width > 0
  const sizedHeight = !desired.text && desired.size.height > 0
  const width = sizedWidth ? desired.size.width : node.size.width
  const height = sizedHeight ? desired.size.height : node.size.height
  if (!near(node.size.width, width) || !near(node.size.height, height)) {
    patch['size'] = { width, height }
  }

  if ('fills' in node && !samePaints(node.fills, desired.fills)) patch['fills'] = desired.fills
  if ('strokes' in node && !sameStrokes(node.strokes, desired.strokes)) {
    patch['strokes'] = desired.strokes
  }
  if (
    desired.cornerRadii &&
    'cornerRadii' in node &&
    !sameRadii(node.cornerRadii, desired.cornerRadii)
  ) {
    patch['cornerRadii'] = desired.cornerRadii
  }
  if (node.type === 'frame') {
    if (node.clipsContent !== desired.clipsContent) patch['clipsContent'] = desired.clipsContent
    if (!sameLayout(node.layout, desired.layout)) patch['layout'] = desired.layout
  }
  if (!sameLayoutChild(node.layoutChild, desired.layoutChild)) {
    patch['layoutChild'] = desired.layoutChild
  }
  if (node.type === 'text' && desired.text) {
    if (node.characters !== desired.text.characters) patch['characters'] = desired.text.characters
    if (!near(node.fontSize, desired.text.fontSize)) patch['fontSize'] = desired.text.fontSize
    if (node.autoWidth !== desired.text.autoWidth) patch['autoWidth'] = desired.text.autoWidth
  }

  return Object.keys(patch).length === 0 ? null : (patch as Partial<SceneNode>)
}

function buildNode(element: CodeElement, desired: Desired): SceneNode {
  const shared = {
    name: desired.name,
    locked: true,
    sourceKey: element.id,
    transform: translation(desired.transform.tx, desired.transform.ty),
    size: desired.size,
    opacity: desired.opacity,
    fills: desired.fills,
    strokes: desired.strokes,
    ...(desired.layoutChild ? { layoutChild: desired.layoutChild } : {}),
  }
  switch (element.type) {
    case 'frame':
      return createFrame({
        ...shared,
        clipsContent: desired.clipsContent,
        cornerRadii: desired.cornerRadii ?? uniformCornerRadii(),
        ...(desired.layout ? { layout: desired.layout } : {}),
      })
    case 'rectangle':
      return createRectangle({
        ...shared,
        cornerRadii: desired.cornerRadii ?? uniformCornerRadii(),
      })
    case 'ellipse':
      return createEllipse(shared)
    case 'text':
      return createText({
        ...shared,
        characters: desired.text?.characters ?? '',
        fontSize: desired.text?.fontSize ?? 16,
        autoWidth: desired.text?.autoWidth ?? true,
      })
  }
}

/**
 * Reconciles one level of children, recursing per element. Returns the ids of the level's
 * nodes in the element order, which the caller uses to fix z-order.
 */
function reconcileLevel(
  document: SceneDocument,
  parentId: NodeId,
  elements: readonly CodeElement[],
  parentLayout: FrameLayout | undefined,
  measureText: MeasureText | undefined,
): NodeId[] {
  const existing = new Map<string, SceneNode>()
  for (const child of document.getChildren(parentId)) {
    if (child.sourceKey !== undefined) existing.set(child.sourceKey, child)
  }

  const kept = new Set<NodeId>()
  const ordered: NodeId[] = []

  for (const element of elements) {
    const desired = desiredOf(element, parentLayout)
    const match = existing.get(element.id)
    // A key match with a changed type is a different thing wearing the same name; rebuilding
    // is the only honest answer, since a rectangle cannot become a frame in place.
    const node = match && match.type === element.type ? match : null

    let id: NodeId
    if (node) {
      const patch = patchFor(node, desired)
      if (patch) document.update(node.id, patch)
      id = node.id
    } else {
      const created = buildNode(element, desired)
      document.insert(created, parentId)
      id = created.id
    }
    kept.add(id)
    ordered.push(id)

    const current = document.expectNode(id)
    if (current.type === 'text' && measureText) {
      const measured = measureText(current)
      if (
        measured &&
        (!near(current.size.width, measured.width) || !near(current.size.height, measured.height))
      ) {
        document.update(id, { size: measured })
      }
    }

    reconcileLevel(document, id, element.children ?? [], desired.layout, measureText)
  }

  // Anything this run did not claim is gone: the code stopped producing it.
  for (const child of existing.values()) {
    if (!kept.has(child.id)) document.remove(child.id)
  }

  // The element order is the paint order. Reorder only where reality disagrees, so a settled
  // run costs nothing here either.
  ordered.forEach((id, index) => {
    if (document.indexOf(id) !== index) document.reorder(id, index)
  })

  return ordered
}

/**
 * Applies a validated run result as the code node's children. Call inside the transaction
 * that writes whatever caused the run, so source, output and size land as one step.
 *
 * Returns the ids of the direct children, in order.
 */
export function applyCodeTree(
  document: SceneDocument,
  codeId: NodeId,
  roots: readonly CodeElement[],
  measureText?: MeasureText,
): NodeId[] {
  const code = document.expectNode(codeId)
  if (code.type !== 'code') {
    throw new Error(`${codeId} is a ${code.type}, not a code node`)
  }
  return document.transact(() =>
    reconcileLevel(document, codeId, roots, undefined, measureText),
  )
}

/**
 * The union of the generated children's boxes in the code node's own space, or null with no
 * children. This is what the code node's `size` caches, under the text node's rule.
 */
export function generatedBounds(document: SceneDocument, codeId: NodeId): Rect | null {
  let bounds: Rect | null = null
  for (const child of document.getChildren(codeId)) {
    const box = transformRect(child.transform, {
      x: 0,
      y: 0,
      width: child.size.width,
      height: child.size.height,
    })
    if (!bounds) {
      bounds = { ...box }
      continue
    }
    const left = Math.min(bounds.x, box.x)
    const top = Math.min(bounds.y, box.y)
    const right = Math.max(bounds.x + bounds.width, box.x + box.width)
    const bottom = Math.max(bounds.y + bounds.height, box.y + box.height)
    bounds = { x: left, y: top, width: right - left, height: bottom - top }
  }
  return bounds
}
