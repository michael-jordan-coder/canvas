import type { ChatItem } from './agentStore'

/**
 * The transcript's presentational logic, out of the component so it can be tested without a
 * DOM. Nothing here touches the store or the socket: it takes the items as they are and
 * answers how they should be laid out.
 */

/** A tool name the model saw, as a line a person can read: "create_frame" to "create frame". */
export function humanize(name: string): string {
  return name.replaceAll('_', ' ')
}

/**
 * Tool calls, thinking and failed steps are process, not conversation, so a consecutive run
 * of them folds into one row. The items stay flat in the store; the fold is purely
 * presentational.
 */
export type Row =
  | { key: string; kind: 'item'; item: ChatItem }
  | { key: string; kind: 'steps'; items: ChatItem[] }

const FOLDS: ReadonlySet<ChatItem['kind']> = new Set(['tool', 'thinking', 'tool-error'])

export function toRows(items: readonly ChatItem[]): Row[] {
  const rows: Row[] = []
  for (const item of items) {
    const folds = FOLDS.has(item.kind)
    const last = rows[rows.length - 1]
    if (folds && last?.kind === 'steps') {
      last.items.push(item)
    } else if (folds) {
      rows.push({ key: `steps-${item.id}`, kind: 'steps', items: [item] })
    } else {
      rows.push({ key: `item-${item.id}`, kind: 'item', item })
    }
  }
  return rows
}

/**
 * Whether a fold hides a failure. A closed run reads as "12 steps" and would otherwise say
 * nothing about a tool that did not work, which is exactly the thing worth opening it for.
 */
export function hasFailure(items: readonly ChatItem[]): boolean {
  return items.some((item) => item.kind === 'tool-error')
}

export function failureCount(items: readonly ChatItem[]): number {
  return items.reduce((count, item) => (item.kind === 'tool-error' ? count + 1 : count), 0)
}

/**
 * How close to the bottom counts as reading the newest message.
 *
 * A transcript that pins unconditionally cannot be scrolled back while a turn is running,
 * because every arriving step drags it down again. Pinning only when the view is already at
 * the end is what lets someone read the middle of a run without fighting it. The slack
 * covers a fractional scroll height, which a zoomed page and a scaled display both produce.
 */
export const PIN_SLACK = 32

export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  slack: number = PIN_SLACK,
): boolean {
  return scrollHeight - clientHeight - scrollTop <= slack
}
