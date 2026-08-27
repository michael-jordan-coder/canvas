/**
 * How wide a docked panel may be dragged. Pure, so the numbers are testable and the
 * resizer holds only the drag.
 */

/**
 * The floor for a panel of dense controls, which is what the layers tree and the property
 * fields are: a label column and a field beside it, at 11px.
 */
export const PANEL_MIN_WIDTH = 240

/**
 * The floor for a panel that also holds the conversation, and it is not arbitrary. Below
 * 300 the person's own message, capped at 88% of the width, stops holding a sentence at
 * 13px, and below 260 the tab row and the composer leave no room for two readable lines
 * between them. It was the assistant card's minimum width before the assistant was docked,
 * and it is the same number for the same reason: what has to fit is a sentence.
 *
 * It costs the canvas 60px at the narrowest setting, which is the price of the two
 * surfaces sharing one column.
 */
export const ASSISTANT_MIN_WIDTH = 300

/** Where a docked panel stops being chrome beside the canvas and starts crowding it. */
export const PANEL_MAX_WIDTH = 480

/**
 * One arrow press. The two resizers step by the same amount because they are the same
 * gesture on different chrome, and a comment claiming that is not the same as the two
 * reading one number.
 */
export const PANEL_NUDGE = 16

/**
 * The minimum is per panel because only one of them has to hold a sentence, so it arrives
 * as an argument rather than as a second constant read from here.
 */
export function clampPanelWidth(width: number, min: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(min, width))
}
