/**
 * How large the assistant's card may be. Pure, so the numbers are testable and so the
 * component holds only the drag.
 *
 * The minimum is not arbitrary: below 300 the person's own message, capped at 88% of the
 * width, stops holding a sentence at 13px, and below 260 the header and the composer leave
 * no room for two readable lines between them. The maximum is where a floating card stops
 * being one and starts being a panel that should have been docked.
 */
export const CARD_MIN_WIDTH = 300
export const CARD_MAX_WIDTH = 560
export const CARD_MIN_HEIGHT = 260
export const CARD_MAX_HEIGHT = 760
/** One arrow press. The same step the panel resizer takes. */
export const CARD_NUDGE = 16

export interface CardSize {
  width: number
  height: number
}

/** Each axis clamped on its own: a drag past a corner still moves the axis that can move. */
export function clampCardSize(size: CardSize): CardSize {
  return {
    width: Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH, size.width)),
    height: Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, size.height)),
  }
}
