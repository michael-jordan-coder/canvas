import type { CommandMap, CommandName } from '@canvas/agent-server/protocol'

/**
 * A tool call as one line a person can read.
 *
 * "Create frame" says almost nothing during a run of fifteen steps; "Create frame Header"
 * says what the agent is doing. The object is already in the args the server forwards, so
 * this only has to know which field carries it.
 *
 * Accessors rather than dotted paths, so the compiler sees the field. `protocol.ts` exists
 * to make a command that drifts fail to build, and a table of strings opted out of exactly
 * that: `fills.0.color` named a field `AgentPaint` does not have, so every fill summary
 * quietly fell back to "Set fills" while the test that covered it hand-built the args and
 * stayed green. A command with no entry still costs nothing and still falls back to its own
 * name, which is what every command used to show.
 */

/** Beyond this the line wraps and stops being a glance. */
const MAX_SUBJECT = 32

/** A field that might name the object. Blank and absent both mean "try the next one". */
type Candidate = string | number | undefined

/**
 * What names the object of a command, most telling first. Always a list, even at length
 * one, because the fallback is the whole point: a text node created with an empty string
 * for its characters is named by whatever is left.
 */
type Subject<K extends CommandName> = (args: CommandMap[K]['args']) => readonly Candidate[]

const SUBJECTS: { [K in CommandName]?: Subject<K> } = {
  create_frame: (a) => [a.name],
  create_rectangle: (a) => [a.name],
  create_ellipse: (a) => [a.name],
  create_text: (a) => [a.characters, a.name],
  create_code_node: (a) => [a.name],
  rename_node: (a) => [a.name],
  update_text: (a) => [a.characters],
  set_fills: (a) => [a.fills?.[0]?.hex],
  set_strokes: (a) => [a.strokes?.[0]?.hex],
  set_corner_radii: (a) => [a.radius],
  set_opacity: (a) => [a.opacity],
  rotate_node: (a) => [a.degrees],
  reorder_node: (a) => [a.command],
  align_nodes: (a) => [a.command],
  flip_nodes: (a) => [a.axis],
  set_auto_layout: (a) => [a.direction],
  set_layout_child: (a) => [a.widthMode, a.heightMode],
}

/**
 * The args arrive as `unknown`, because they crossed the socket: the command itself is
 * validated where it runs, and a summary is display only. The accessor is trusted with a
 * shape it may not have been given, so the object check is here rather than in eighteen
 * accessors, and a field that is missing reads as absent exactly as it did before.
 */
function subjectOf(name: CommandName, args: unknown): string | null {
  const read = SUBJECTS[name] as ((args: unknown) => readonly Candidate[]) | undefined
  if (!read || typeof args !== 'object' || args === null) return null
  for (const value of read(args)) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
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
  const words = name.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function toolSummary(name: CommandName, args: unknown): string {
  const label = humanizeCommand(name)
  const subject = subjectOf(name, args)
  if (subject !== null) return `${label} ${truncate(subject)}`
  // Nothing names an object, so say how much was touched. One is the uninteresting case and
  // reads as noise: "Delete nodes 1 layers" says less than "Delete nodes".
  const count = countOf(args)
  return count > 1 ? `${label} ${count} layers` : label
}
