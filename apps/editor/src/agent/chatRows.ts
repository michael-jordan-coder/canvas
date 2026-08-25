import type { ChatItem } from './agentStore'

/**
 * The transcript's presentational logic, out of the component so it can be tested without a
 * DOM. Nothing here touches the store or the socket: it takes the items as they are and
 * answers how they should be laid out.
 */

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
 * How many of a fold's steps failed, and so also whether any did. A closed run reads as
 * "12 steps" and would otherwise say nothing about a tool that did not work, which is
 * exactly the thing worth opening it for. One walk answers both questions the chip asks.
 */
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
const PIN_SLACK = 32

export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - clientHeight - scrollTop <= PIN_SLACK
}

/**
 * What a folded run says on its closed line.
 *
 * Two orthogonal questions, which is why it is not one expression: a growing run shows the
 * step it is on, so the live line doubles as the activity readout, and a settled one shows
 * how much it did and whether any of it failed. Thinking has no object to name, so it says
 * only that.
 */
export function stepsLabel(items: readonly ChatItem[], live: boolean): string {
  const latest = items[items.length - 1]
  if (live && latest) return latest.kind === 'thinking' ? 'Thinking' : latest.text
  const count = `${items.length} ${items.length === 1 ? 'step' : 'steps'}`
  const failures = failureCount(items)
  return failures > 0 ? `${count}, ${failures} failed` : count
}
