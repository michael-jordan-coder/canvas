import {
  acceptsManualChildren,
  createCode,
  createEllipse,
  createFrame,
  createRectangle,
  createText,
  angleOf,
  degrees,
  isPainted,
  parseHex,
  radians,
  toHex,
  uniformCornerRadii,
  paintColor,
  paintOpacity,
  type CornerRadii,
  type FrameNode,
  type JsonValue,
  type NodeId,
  type Paint,
  type PaintedNode,
  type SceneNode,
  type Stroke,
  type TextNode,
} from '@canvas/document'
import type {
  AgentCornerRadii,
  AgentLayout,
  AgentNode,
  AgentPaint,
  AgentStroke,
  CommandMap,
  CommandName,
  DocumentSnapshot,
} from '@canvas/agent-server/protocol'
import { scene } from '../state/scene'
import { useUI } from '../state/uiStore'
import {
  addAutoLayout,
  relayout,
  removeAutoLayout,
  updateFrameLayout,
  updateLayoutChild,
  wrapInAutoLayout,
} from '../state/autoLayout'
import { alignSelection } from '../state/align'
import { reorderSelection } from '../state/order'
import { setNodesAngle } from '../state/rotate'
import { flipNodes } from '../state/flip'
import { duplicateNodes } from '../state/duplicate'
import { rerunCodeNodesIn, runCodeNodeNow, setCodeSourceNow } from '../state/code'
import { updateText } from '../state/font'

/**
 * Where the agent's commands become document edits.
 *
 * Every command goes through the exact code paths the panels and shortcuts use, relayout
 * included, so an agent edit and a hand edit are indistinguishable to the document, to undo
 * and to the renderer. Errors are thrown with messages written for the model, since they
 * travel back as the tool result: "No node n7" is something it can recover from.
 *
 * The server has already validated shapes against its schemas, so this file checks meaning
 * (does the node exist, can it hold children) rather than types.
 */

type Args<K extends CommandName> = CommandMap[K]['args']
type Result<K extends CommandName> = CommandMap[K]['result']

function resolve(id: string): SceneNode {
  const node = scene.getNode(id as NodeId)
  if (!node) throw new Error(`No node ${id}. Call get_document for current ids.`)
  return node
}

function resolveParent(id: string | undefined): SceneNode {
  const parent = id === undefined ? scene.expectNode(scene.rootId) : resolve(id)
  if (!acceptsManualChildren(parent)) {
    // A code node holds children but writes them itself; the agent edits it through its
    // source, the same door the panel uses.
    throw new Error(`${parent.id} is a ${parent.type} and cannot take children directly.`)
  }
  return parent
}

function resolveIds(ids: readonly string[]): NodeId[] {
  return ids.map((id) => resolve(id).id)
}

/**
 * Props arrive over MCP as JSON already; the round trip is what proves it, and it strips
 * anything a structured clone would carry that JSON cannot.
 */
function jsonProps(props: Record<string, unknown> | undefined): Record<string, JsonValue> {
  if (!props) return {}
  return JSON.parse(JSON.stringify(props)) as Record<string, JsonValue>
}

// Paints ---------------------------------------------------------------------------------

function toPaint(paint: AgentPaint): Paint {
  const parsed = parseHex(paint.hex)
  if (!parsed) throw new Error(`"${paint.hex}" is not a valid hex color.`)
  return paint.opacity !== undefined && paint.opacity < 1
    ? { ...parsed, opacity: paint.opacity }
    : parsed
}

function toStroke(stroke: AgentStroke): Stroke {
  return {
    paint: toPaint({ hex: stroke.hex, ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}) }),
    weight: stroke.weight,
    align: stroke.align,
  }
}

function fromPaint(paint: Paint): AgentPaint {
  // The protocol speaks in single hex colours, so a gradient reports as its first stop.
  // The agent cannot author gradients yet either; that is a protocol change for later.
  const color = paintColor(paint)
  const opacity = paintOpacity(paint) * color.a
  return { hex: toHex(color), ...(opacity < 1 ? { opacity } : {}) }
}

function fromStroke(stroke: Stroke): AgentStroke {
  const paint = fromPaint(stroke.paint)
  return {
    hex: paint.hex,
    weight: stroke.weight,
    align: stroke.align,
    ...(paint.opacity !== undefined ? { opacity: paint.opacity } : {}),
  }
}

// Snapshots ------------------------------------------------------------------------------

const round = (value: number): number => Math.round(value * 100) / 100

function radiiOf(radii: CornerRadii): AgentCornerRadii | undefined {
  const { topLeft, topRight, bottomRight, bottomLeft } = radii
  if (topLeft === 0 && topRight === 0 && bottomRight === 0 && bottomLeft === 0) return undefined
  return { topLeft, topRight, bottomRight, bottomLeft }
}

function layoutOf(node: FrameNode): AgentLayout | undefined {
  const layout = node.layout
  if (!layout) return undefined
  return {
    direction: layout.direction,
    gap: layout.gap,
    padding: { ...layout.padding },
    mainAlign: layout.mainAlign,
    // space-between has no meaning across the run, so the model never sees it there.
    crossAlign: layout.crossAlign === 'space-between' ? 'start' : layout.crossAlign,
    mainSizing: layout.mainSizing,
    crossSizing: layout.crossSizing,
  }
}

function snapshotNode(node: SceneNode): AgentNode {
  const rotation = degrees(angleOf(node.transform))
  const snapshot: AgentNode = {
    id: node.id,
    type: node.type,
    name: node.name,
    x: round(node.transform.tx),
    y: round(node.transform.ty),
    width: round(node.size.width),
    height: round(node.size.height),
  }
  if (Math.abs(rotation) > 0.01) snapshot.rotation = round(rotation)
  if (!node.visible) snapshot.visible = false
  if (node.locked) snapshot.locked = true
  if (node.opacity < 1) snapshot.opacity = round(node.opacity)

  if (isPainted(node)) {
    if (node.fills.length > 0) snapshot.fills = node.fills.map(fromPaint)
    if (node.strokes.length > 0) snapshot.strokes = node.strokes.map(fromStroke)
  }
  if (node.type === 'frame' || node.type === 'rectangle' || node.type === 'code') {
    const radii = radiiOf(node.cornerRadii)
    if (radii) snapshot.cornerRadii = radii
  }
  if (node.type === 'frame') {
    snapshot.clipsContent = node.clipsContent
    const layout = layoutOf(node)
    if (layout) snapshot.layout = layout
  }
  if (node.type === 'code') {
    snapshot.clipsContent = node.clipsContent
    snapshot.code = { props: node.props, sourceLength: node.source.length }
  }
  if (node.layoutChild) snapshot.layoutChild = { ...node.layoutChild }
  if (node.type === 'text') {
    snapshot.text = {
      characters: node.characters,
      fontSize: node.fontSize,
      autoWidth: node.autoWidth,
    }
  }
  if (node.children.length > 0) {
    snapshot.children = scene.getChildren(node.id).map(snapshotNode)
  }
  return snapshot
}

function snapshotDocument(): DocumentSnapshot {
  return {
    root: scene.rootId,
    selection: [...useUI.getState().selection],
    tree: snapshotNode(scene.expectNode(scene.rootId)),
  }
}

// Creation -------------------------------------------------------------------------------

interface ShapeInit {
  parentId?: string
  x: number
  y: number
  width: number
  height: number
  name?: string
  fills?: AgentPaint[]
  strokes?: AgentStroke[]
  cornerRadius?: number
}

function insertShape(node: SceneNode, args: { parentId?: string }): { id: string } {
  const parent = resolveParent(args.parentId)
  return scene.transact(() => {
    scene.insert(node, parent.id)
    relayout(scene, [node.id])
    return { id: node.id }
  })
}

function shapeInit(args: ShapeInit): {
  name?: string
  transform: { a: number; b: number; c: number; d: number; tx: number; ty: number }
  size: { width: number; height: number }
  fills: Paint[]
  strokes: Stroke[]
} {
  return {
    ...(args.name ? { name: args.name } : {}),
    transform: { a: 1, b: 0, c: 0, d: 1, tx: args.x, ty: args.y },
    size: { width: args.width, height: args.height },
    fills: (args.fills ?? []).map(toPaint),
    strokes: (args.strokes ?? []).map(toStroke),
  }
}

// The commands ---------------------------------------------------------------------------

type Handlers = { [K in CommandName]: (args: Args<K>) => Result<K> | Promise<Result<K>> }

const handlers: Handlers = {
  get_document: () => snapshotDocument(),

  get_node: ({ nodeId }) => snapshotNode(resolve(nodeId)),

  set_selection: ({ nodeIds }) => {
    const ids = resolveIds(nodeIds)
    useUI.getState().setSelection(ids)
    return { selected: ids }
  },

  create_frame: (args) =>
    insertShape(
      createFrame({
        ...shapeInit(args),
        cornerRadii: uniformCornerRadii(args.cornerRadius ?? 0),
        clipsContent: args.clipsContent ?? true,
      }),
      args,
    ),

  create_rectangle: (args) =>
    insertShape(
      createRectangle({
        ...shapeInit(args),
        cornerRadii: uniformCornerRadii(args.cornerRadius ?? 0),
      }),
      args,
    ),

  create_ellipse: (args) => insertShape(createEllipse(shapeInit(args)), args),

  create_text: (args) => {
    const parent = resolveParent(args.parentId)
    const node = createText({
      ...(args.name ? { name: args.name } : {}),
      transform: { a: 1, b: 0, c: 0, d: 1, tx: args.x, ty: args.y },
      characters: args.characters,
      fontSize: args.fontSize ?? 16,
      autoWidth: args.width === undefined,
      size: { width: args.width ?? 0, height: 0 },
      fills: (args.fills ?? []).map(toPaint),
    })
    return scene.transact(() => {
      scene.insert(node, parent.id)
      // The empty change measures the node and writes its bounds, the same door every
      // other text edit goes through.
      updateText(node, {})
      return { id: node.id }
    })
  },

  update_text: ({ nodeId, ...changes }) => {
    const node = resolve(nodeId)
    if (node.type !== 'text') throw new Error(`${nodeId} is a ${node.type}, not a text node.`)
    const patch: Partial<TextNode> = {}
    if (changes.characters !== undefined) patch.characters = changes.characters
    if (changes.fontSize !== undefined) patch.fontSize = changes.fontSize
    if (changes.autoWidth !== undefined) patch.autoWidth = changes.autoWidth
    updateText(node, patch)
    return { id: node.id }
  },

  move_node: ({ nodeId, x, y }) => {
    const node = resolve(nodeId)
    scene.transact(() => {
      scene.update(node.id, { transform: { ...node.transform, tx: x, ty: y } })
      relayout(scene, [node.id])
    })
    return { id: node.id }
  },

  resize_node: ({ nodeId, width, height }) => {
    const node = resolve(nodeId)
    if (width === undefined && height === undefined) {
      throw new Error('Pass width, height, or both.')
    }

    if (node.type === 'text') {
      if (width === undefined) {
        throw new Error("A text node's height is measured from its text; set width instead.")
      }
      updateText(node, { autoWidth: false, size: { width, height: node.size.height } })
      return { id: node.id }
    }

    scene.transact(() => {
      // A resize claims the axes it sets, exactly as dragging a handle does: a hug axis
      // would hand the size straight back to the layout otherwise.
      if (node.type === 'frame' && node.layout) {
        const horizontal = node.layout.direction === 'horizontal'
        const claimsMain = horizontal ? width !== undefined : height !== undefined
        const claimsCross = horizontal ? height !== undefined : width !== undefined
        if ((claimsMain && node.layout.mainSizing === 'hug') || (claimsCross && node.layout.crossSizing === 'hug')) {
          updateFrameLayout(scene, node.id, {
            ...(claimsMain && node.layout.mainSizing === 'hug' ? { mainSizing: 'fixed' } : {}),
            ...(claimsCross && node.layout.crossSizing === 'hug' ? { crossSizing: 'fixed' } : {}),
          })
        }
      }
      scene.update(node.id, {
        size: { width: width ?? node.size.width, height: height ?? node.size.height },
      })
      relayout(scene, [node.id])
    })
    return { id: node.id }
  },

  rotate_node: ({ nodeId, degrees: value }) => {
    const node = resolve(nodeId)
    setNodesAngle(scene, [node.id], radians(value))
    return { id: node.id }
  },

  set_fills: ({ nodeId, fills }) => {
    const node = resolve(nodeId)
    if (!isPainted(node)) throw new Error(`${nodeId} is a ${node.type} and has no fills.`)
    scene.update<PaintedNode>(node.id, { fills: fills.map(toPaint) })
    return { id: node.id }
  },

  set_strokes: ({ nodeId, strokes }) => {
    const node = resolve(nodeId)
    if (!isPainted(node)) throw new Error(`${nodeId} is a ${node.type} and has no strokes.`)
    scene.update<PaintedNode>(node.id, { strokes: strokes.map(toStroke) })
    return { id: node.id }
  },

  set_corner_radii: ({ nodeId, radius, radii }) => {
    const node = resolve(nodeId)
    if (node.type !== 'frame' && node.type !== 'rectangle') {
      throw new Error(`Corner radii apply to frames and rectangles, not to a ${node.type}.`)
    }
    const next: CornerRadii = radii ? { ...radii } : uniformCornerRadii(radius ?? 0)
    scene.update<FrameNode>(node.id, { cornerRadii: next })
    return { id: node.id }
  },

  set_opacity: ({ nodeId, opacity }) => {
    const node = resolve(nodeId)
    scene.update(node.id, { opacity })
    return { id: node.id }
  },

  set_visible: ({ nodeId, visible }) => {
    const node = resolve(nodeId)
    scene.transact(() => {
      scene.update(node.id, { visible })
      // A hidden child leaves its parent's flow, so the toggle is also a layout change.
      relayout(scene, [node.id])
    })
    return { id: node.id }
  },

  rename_node: ({ nodeId, name }) => {
    const node = resolve(nodeId)
    scene.update(node.id, { name })
    return { id: node.id }
  },

  delete_nodes: ({ nodeIds }) => {
    const ids = resolveIds(nodeIds)
    const parents = ids
      .map((id) => scene.getNode(id)?.parent)
      .filter((id): id is NodeId => id != null)
    scene.transact(() => {
      for (const id of ids) scene.remove(id)
      relayout(scene, parents)
      const remaining = useUI.getState().selection.filter((id) => scene.getNode(id))
      useUI.getState().setSelection(remaining)
    })
    return { deleted: ids }
  },

  duplicate_nodes: ({ nodeIds, dx, dy }) => {
    const ids = resolveIds(nodeIds)
    const created = duplicateNodes(scene, ids, { x: dx ?? 10, y: dy ?? 10 })
    rerunCodeNodesIn(created.map((node) => node.id))
    return { ids: created.map((node) => node.id) }
  },

  create_code_node: async ({ parentId, x, y, name, source, props }) => {
    const parent = resolveParent(parentId)
    const node = createCode({
      ...(name ? { name } : {}),
      source,
      props: jsonProps(props),
      transform: { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
    })
    scene.transact(() => {
      scene.insert(node, parent.id)
      relayout(scene, [node.id])
    })
    const error = await runCodeNodeNow(node.id)
    return error ? { id: node.id, error } : { id: node.id }
  },

  get_code_source: ({ nodeId }) => {
    const node = resolve(nodeId)
    if (node.type !== 'code') throw new Error(`${node.id} is a ${node.type}, not a code node.`)
    return { source: node.source, props: node.props }
  },

  set_code_source: async ({ nodeId, source, props }) => {
    const node = resolve(nodeId)
    if (node.type !== 'code') throw new Error(`${node.id} is a ${node.type}, not a code node.`)
    const error = await setCodeSourceNow(node.id, {
      ...(source !== undefined ? { source } : {}),
      ...(props !== undefined ? { props: jsonProps(props) } : {}),
    })
    return error ? { id: node.id, error } : { id: node.id }
  },

  reparent_node: ({ nodeId, parentId, index }) => {
    const node = resolve(nodeId)
    const parent = resolveParent(parentId)
    if (node.id === parent.id || scene.isAncestorOf(node.id, parent.id)) {
      throw new Error('A node cannot be moved inside itself or its own descendant.')
    }
    const previousParent = node.parent
    scene.transact(() => {
      scene.reparent(node.id, parent.id, index)
      relayout(scene, previousParent ? [node.id, previousParent] : [node.id])
    })
    return { id: node.id }
  },

  reorder_node: ({ nodeId, command }) => {
    const node = resolve(nodeId)
    reorderSelection(scene, [node.id], command)
    return { id: node.id }
  },

  align_nodes: ({ nodeIds, command }) => {
    const ids = resolveIds(nodeIds)
    alignSelection(scene, ids, command)
    return { aligned: ids }
  },

  flip_nodes: ({ nodeIds, axis }) => {
    const ids = resolveIds(nodeIds)
    flipNodes(scene, ids, axis)
    return { flipped: ids }
  },

  set_auto_layout: ({ frameId, ...changes }) => {
    const node = resolve(frameId)
    if (node.type !== 'frame') throw new Error(`${frameId} is a ${node.type}, not a frame.`)
    scene.transact(() => {
      if (!node.layout) addAutoLayout(scene, node.id)
      if (Object.keys(changes).length > 0) updateFrameLayout(scene, node.id, changes)
    })
    return { id: node.id }
  },

  remove_auto_layout: ({ frameId }) => {
    const node = resolve(frameId)
    if (node.type !== 'frame') throw new Error(`${frameId} is a ${node.type}, not a frame.`)
    if (!node.layout) throw new Error(`${frameId} has no auto layout to remove.`)
    removeAutoLayout(scene, node.id)
    return { id: node.id }
  },

  set_layout_child: ({ nodeId, widthMode, heightMode }) => {
    const node = resolve(nodeId)
    updateLayoutChild(scene, node, {
      ...(widthMode ? { widthMode } : {}),
      ...(heightMode ? { heightMode } : {}),
    })
    return { id: node.id }
  },

  wrap_in_auto_layout: ({ nodeIds }) => {
    const ids = resolveIds(nodeIds)
    const frame = scene.transact(() => wrapInAutoLayout(scene, ids))
    if (!frame) throw new Error('Nothing wrappable in that selection.')
    return { frameId: frame.id }
  },
}

/** The one entry the connection calls. Unknown names reject rather than crash the socket. */
export async function executeCommand(name: string, args: unknown): Promise<unknown> {
  const handler = handlers[name as CommandName] as
    | ((args: unknown) => unknown | Promise<unknown>)
    | undefined
  if (!handler) throw new Error(`Unknown command ${name}.`)
  return handler(args)
}
