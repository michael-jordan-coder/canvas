import type { CommandName } from '@canvas/agent-server/protocol'
import { humanize } from './chatRows'

/**
 * A tool call as one line a person can read.
 *
 * "Create frame" says almost nothing during a run of fifteen steps; "Create frame Header"
 * says what the agent is doing. The object is already in the args the server forwards, so
 * this only has to know which field carries it.
 *
 * A table rather than a switch, and paths rather than accessors, so a new command adds one
 * line here or none at all: with no entry it falls back to the command's own name, which is
 * what every command used to show.
 */

/** Beyond this the line wraps and stops being a glance. */
const MAX_SUBJECT = 32

/**
 * Which arg carries the object of the command, most telling first. Dotted paths index into
 * arrays too, which is how a fill's colour is reached without unpacking the paint.
 */
const SUBJECT_FIELDS: Partial<Record<CommandName, readonly string[]>> = {
  create_frame: ['name'],
  create_rectangle: ['name'],
  create_ellipse: ['name'],
  create_text: ['characters', 'name'],
  create_code_node: ['name'],
  rename_node: ['name'],
  update_text: ['characters'],
  set_fills: ['fills.0.color'],
  set_strokes: ['strokes.0.color'],
  set_corner_radii: ['radius'],
  set_opacity: ['opacity'],
  rotate_node: ['degrees'],
  reorder_node: ['command'],
  align_nodes: ['command'],
  flip_nodes: ['axis'],
  screenshot: ['fit'],
  set_auto_layout: ['direction'],
  set_layout_child: ['widthMode', 'heightMode'],
}

/** A string or a finite number at the end of a dotted path, or null for anything else. */
function readPath(args: unknown, path: string): string | null {
  let current: unknown = args
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null) return null
    current = (current as Record<string, unknown>)[key]
  }
  if (typeof current === 'string') return current.trim() === '' ? null : current.trim()
  if (typeof current === 'number' && Number.isFinite(current)) return String(current)
  return null
}

function countOf(args: unknown): number {
  if (typeof args !== 'object' || args === null) return 0
  const ids = (args as { nodeIds?: unknown }).nodeIds
  return Array.isArray(ids) ? ids.length : 0
}

function truncate(value: string): string {
  const single = value.replace(/\s+/g, ' ')
  return single.length <= MAX_SUBJECT ? single : `${single.slice(0, MAX_SUBJECT - 1)}…`
}

/** The command's own name, as a sentence opener: "set_corner_radii" to "Set corner radii". */
export function humanizeCommand(name: string): string {
  const words = humanize(name)
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function toolSummary(name: CommandName, args: unknown): string {
  const label = humanizeCommand(name)
  for (const path of SUBJECT_FIELDS[name] ?? []) {
    const value = readPath(args, path)
    if (value !== null) return `${label} ${truncate(value)}`
  }
  // Nothing names an object, so say how much was touched. One is the uninteresting case and
  // reads as noise: "Delete nodes 1 layers" says less than "Delete nodes".
  const count = countOf(args)
  return count > 1 ? `${label} ${count} layers` : label
}
