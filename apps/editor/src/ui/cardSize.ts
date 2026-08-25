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
/**
 * One arrow press, for both resizers. The card and the docked panels step by the same
 * amount because they are the same gesture on different chrome, and a comment claiming
 * that is not the same as the two reading one number.
 */
export const PANEL_NUDGE = 16

/**
 * Where the card's size is written and where it is remembered, beside the numbers that
 * bound it. The vocabulary of the card's size is one thing, so it lives in one file rather
 * than as string literals threaded through the JSX of whatever happens to render the grip.
 */
export const CARD_WIDTH_VAR = '--agent-card-width'
export const CARD_HEIGHT_VAR = '--agent-card-height'
export const CARD_WIDTH_KEY = 'figma-canvas:agent-width'
export const CARD_HEIGHT_KEY = 'figma-canvas:agent-height'

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
