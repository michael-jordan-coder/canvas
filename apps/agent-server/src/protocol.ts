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
  type: 'page' | 'frame' | 'rectangle' | 'ellipse' | 'text' | 'code'
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
  /**
   * The source body deliberately stays out of the snapshot: a document with a few code nodes
   * would otherwise ship kilobytes of TSX on every `get_document`. `get_code_source` is the
   * read. Generated children still appear under `children`, locked, so the model sees what
   * the code produced without owning it.
   */
  code?: { props: Record<string, unknown>; sourceLength: number }
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
  create_code_node: {
    args: {
      /** Absent means the page. */
      parentId?: string
      x: number
      y: number
      name?: string
      source: string
      props?: Record<string, unknown>
    }
    /** `error` carries the compile or run failure so the model can fix and retry. */
    result: { id: string; error?: string }
  }
  get_code_source: {
    args: { nodeId: string }
    result: { source: string; props: Record<string, unknown> }
  }
  set_code_source: {
    args: { nodeId: string; source?: string; props?: Record<string, unknown> }
    result: { id: string; error?: string }
  }
}

export type CommandName = keyof CommandMap

// Asking the person -----------------------------------------------------------------------

/**
 * One offered answer. `description` is optional subtext under the label, the way Claude Code's
 * question options carry one: "Corporate" reads better with "restrained, lots of whitespace"
 * beside it, and a bare label is fine when it needs nothing.
 */
export interface AgentQuestionOption {
  label: string
  description?: string
}

/**
 * A question the agent puts to the person mid-turn, the AskUserQuestion pattern.
 *
 * It is not a document command: it edits nothing and it blocks on a human rather than on the
 * editor, so it rides its own `ask`/`answer` pair rather than `command`/`result`, with its own
 * long timeout. `header` is a short chip label ("Direction", "Tone"); `options` are the 2 to 4
 * offered answers, and the editor always adds a free-text "Other" beside them. `multiSelect`
 * lets the person pick several rather than one.
 */
export interface AgentQuestion {
  question: string
  header: string
  options: AgentQuestionOption[]
  multiSelect: boolean
}

/**
 * What the person chose. `selected` are the labels they picked (one unless `multiSelect`),
 * `other` is the free-text answer if they used the Other field. At least one is non-empty;
 * the editor does not send an empty answer.
 */
export interface QuestionAnswer {
  selected: string[]
  other?: string
}

/**
 * The answer as one line for the model, which is what a tool result is. Selected labels first,
 * the free-text answer last, joined the way a person would read a list back. Kept here in the
 * shared contract so the server (the tool result) and the editor (the answered-card record)
 * say the same thing rather than formatting it twice.
 */
export function formatAnswer(answer: QuestionAnswer): string {
  const parts = [...answer.selected]
  const other = answer.other?.trim()
  if (other) parts.push(other)
  return parts.join(', ')
}

// Messages -------------------------------------------------------------------------------

/** An image the person attached to a chat message, as reference material for the agent. */
export interface Attachment {
  /** Base64 without the data-URL prefix, which is what the SDK wants. */
  base64: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}

export const MAX_ATTACHMENTS = 4
/** Bytes, before base64. Comfortably under the 8 MiB the SDK will take per image. */
export const MAX_ATTACHMENT_BYTES = 5_000_000

/** Why a turn ended. `ok` is the ordinary case and says nothing to the person. */
export type TurnEndReason = 'ok' | 'stopped' | 'max_turns' | 'error'

export type ServerMessage =
  /**
   * `session` is whether the server still holds the conversation. It restarts often under
   * `--watch` and its session goes with it, so a transcript the editor restored can be one
   * the model no longer remembers, and the editor says so rather than letting the person
   * refer back to something that is no longer context.
   *
   * `token` is the handshake's other half. `origin.ts` lets this server refuse a page, and the
   * URL token lets it refuse a client without the secret; this echoes the same secret back so
   * the editor can refuse a server without it, which is a rogue process squatting on the port
   * while the real sidecar is down. The editor holds nothing back and runs no command until
   * this matches the token it was handed. See `token.ts` for what that fence is and is not.
   */
  | { type: 'hello'; busy: boolean; session: boolean; token: string }
  | { type: 'turn_start' }
  | { type: 'assistant'; text: string }
  | { type: 'thinking'; text: string }
  /**
   * A tool call starting. The args ride along so the editor can say what it is about:
   * "Create frame Header" rather than "create frame". It is display only; the `command`
   * that follows is what actually runs, and the editor answers that one.
   */
  | { type: 'tool'; name: CommandName; args: unknown }
  | { type: 'command'; id: number; name: CommandName; args: unknown }
  /**
   * A question the agent is asking the person, its `answer` awaited before the turn goes on.
   * Its own message rather than a `command` because it edits no document and blocks on a human:
   * the editor renders it as an interactive card and answers with `answer`, not `result`, and
   * the server holds it on a far longer timeout than a document command gets.
   */
  | { type: 'ask'; id: number; question: AgentQuestion }
  /**
   * How the turn ended, as a reason rather than as a sentence.
   *
   * The distinctions matter to the panel and only it can act on them: a stop is the person
   * having asked, so it reads as a state rather than as a failure, and the step cap is
   * process the same turn can be asked to continue past, which a real error is not. The
   * SDK reports all three as an unsuccessful result, so the server is the only thing that
   * can tell them apart, and the words for them belong with the rest of the assistant's
   * copy in the editor.
   *
   * `detail` is whatever the reason cannot carry: an unmapped SDK subtype, or the message
   * of a thrown error. It is the only clue about what happened, so it is never dropped.
   */
  | { type: 'turn_end'; reason: TurnEndReason; detail?: string }
  /**
   * This editor has been displaced by another tab, sent just before its socket is closed.
   *
   * The server keeps one editor, because a turn edits one document and the person is
   * looking at one of them. Without this the closed tab could not tell being displaced from
   * the server going away, so it reconnected on its backoff, displaced the other tab in
   * turn, and the two evicted each other about once a second for as long as both were open.
   * Being told is what lets the loser stop and wait to be asked for.
   */
  | { type: 'evicted' }
  /**
   * A message the server refused rather than ran, with the text handed back so the editor
   * can return it to the composer. The editor guards against sending while busy, but it
   * cannot always know: a second tab, or a send that crossed with a turn starting.
   */
  | { type: 'rejected'; reason: 'busy'; text: string }

export type ClientMessage =
  | { type: 'chat'; text: string; attachments?: Attachment[] }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'result'; id: number; ok: boolean; value?: unknown; error?: string }
  /** The person's answer to an `ask`, matched to it by id. The other half of `ask`. */
  | { type: 'answer'; id: number; answer: QuestionAnswer }
