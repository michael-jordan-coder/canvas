/**
 * The wire contract between the agent server and the editor.
 *
 * This module is the one thing both sides import: the server sends `command` messages built
 * from these names, the editor's executor implements them. It stays free of zod, ws and
 * everything Node so the editor can import it through Vite the way it imports the document
 * package, types and one constant and nothing else.
 *
 * The command arg types here and the zod schemas in `tools.ts` describe the same shapes and
 * are kept aligned by hand. The schemas exist for the model's benefit (validation with a
 * message it can act on); these types exist for the executor's. A drift between them shows
 * up as a tool call the executor rejects, not as silent corruption, because the executor
 * looks nodes up and ignores fields it does not know.
 */

/** One below the editor's 5173, and fixed for the same reason its strictPort is. */
export const AGENT_PORT = 5174

// Values the tools traffic in ------------------------------------------------------------

/** A paint as the agent speaks it: hex in, hex out. Topmost paint first, like the panel. */
export interface AgentPaint {
  hex: string
  /** 0 to 1. Absent means 1. */
  opacity?: number
}

export interface AgentStroke {
  hex: string
  weight: number
  align: 'inside' | 'outside' | 'center'
  opacity?: number
}

export interface AgentCornerRadii {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

export interface AgentLayout {
  direction: 'horizontal' | 'vertical'
  gap: number
  padding: { top: number; right: number; bottom: number; left: number }
  mainAlign: 'start' | 'center' | 'end' | 'space-between'
  crossAlign: 'start' | 'center' | 'end'
  mainSizing: 'fixed' | 'hug'
  crossSizing: 'fixed' | 'hug'
}

/**
 * A node as `get_document` reports it. Positions are the node's origin in its parent's
 * space, y down; `rotation` is degrees clockwise. Fields at their default are omitted so a
 * big document reads as data rather than noise.
 */
export interface AgentNode {
  id: string
  type: 'page' | 'frame' | 'rectangle' | 'ellipse' | 'text'
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  visible?: false
  locked?: true
  opacity?: number
  fills?: AgentPaint[]
  strokes?: AgentStroke[]
  cornerRadii?: AgentCornerRadii
  clipsContent?: boolean
  layout?: AgentLayout
  layoutChild?: { widthMode: 'fixed' | 'fill'; heightMode: 'fixed' | 'fill' }
  text?: { characters: string; fontSize: number; autoWidth: boolean }
  children?: AgentNode[]
}

export interface DocumentSnapshot {
  root: string
  selection: string[]
  tree: AgentNode
}

// Commands -------------------------------------------------------------------------------

export interface CreateShapeArgs {
  /** Absent means the page. */
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

/**
 * Every command the editor executes for the agent, name to args and result.
 *
 * The executor switches over these names, so adding a command here without implementing it
 * there is a compile error in the editor, which is the direction the drift should fail in.
 */
export interface CommandMap {
  get_document: { args: Record<string, never>; result: DocumentSnapshot }
  get_node: { args: { nodeId: string }; result: AgentNode }
  screenshot: {
    args: { fit?: 'view' | 'all' | 'selection'; nodeId?: string }
    result: { mimeType: string; base64: string }
  }
  set_selection: { args: { nodeIds: string[] }; result: { selected: string[] } }
  create_frame: {
    args: CreateShapeArgs & { clipsContent?: boolean }
    result: { id: string }
  }
  create_rectangle: { args: CreateShapeArgs; result: { id: string } }
  create_ellipse: { args: CreateShapeArgs; result: { id: string } }
  create_text: {
    args: {
      parentId?: string
      x: number
      y: number
      characters: string
      fontSize?: number
      /** Sets a fixed wrap width. Absent means the box sizes itself to its words. */
      width?: number
      name?: string
      fills?: AgentPaint[]
    }
    result: { id: string }
  }
  update_text: {
    args: { nodeId: string; characters?: string; fontSize?: number; autoWidth?: boolean }
    result: { id: string }
  }
  move_node: { args: { nodeId: string; x: number; y: number }; result: { id: string } }
  resize_node: {
    args: { nodeId: string; width?: number; height?: number }
    result: { id: string }
  }
  rotate_node: { args: { nodeId: string; degrees: number }; result: { id: string } }
  set_fills: { args: { nodeId: string; fills: AgentPaint[] }; result: { id: string } }
  set_strokes: { args: { nodeId: string; strokes: AgentStroke[] }; result: { id: string } }
  set_corner_radii: {
    args: { nodeId: string; radius?: number; radii?: AgentCornerRadii }
    result: { id: string }
  }
  set_opacity: { args: { nodeId: string; opacity: number }; result: { id: string } }
  set_visible: { args: { nodeId: string; visible: boolean }; result: { id: string } }
  rename_node: { args: { nodeId: string; name: string }; result: { id: string } }
  delete_nodes: { args: { nodeIds: string[] }; result: { deleted: string[] } }
  duplicate_nodes: {
    args: { nodeIds: string[]; dx?: number; dy?: number }
    result: { ids: string[] }
  }
  reparent_node: {
    args: { nodeId: string; parentId: string; index?: number }
    result: { id: string }
  }
  reorder_node: {
    args: { nodeId: string; command: 'forward' | 'backward' | 'front' | 'back' }
    result: { id: string }
  }
  align_nodes: {
    args: {
      nodeIds: string[]
      command:
        | 'left'
        | 'centerX'
        | 'right'
        | 'top'
        | 'centerY'
        | 'bottom'
        | 'distributeHorizontal'
        | 'distributeVertical'
    }
    result: { aligned: string[] }
  }
  flip_nodes: {
    args: { nodeIds: string[]; axis: 'horizontal' | 'vertical' }
    result: { flipped: string[] }
  }
  set_auto_layout: {
    args: { frameId: string } & Partial<AgentLayout>
    result: { id: string }
  }
  remove_auto_layout: { args: { frameId: string }; result: { id: string } }
  set_layout_child: {
    args: { nodeId: string; widthMode?: 'fixed' | 'fill'; heightMode?: 'fixed' | 'fill' }
    result: { id: string }
  }
  wrap_in_auto_layout: { args: { nodeIds: string[] }; result: { frameId: string } }
}

export type CommandName = keyof CommandMap

// Messages -------------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'hello'; busy: boolean }
  | { type: 'turn_start' }
  | { type: 'assistant'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: CommandName }
  | { type: 'command'; id: number; name: CommandName; args: unknown }
  | { type: 'turn_end'; error?: string }

export type ClientMessage =
  | { type: 'chat'; text: string }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'result'; id: number; ok: boolean; value?: unknown; error?: string }
