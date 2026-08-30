import type { Rect, Vec2 } from '@canvas/document'

/**
 * What a press means before a gesture owns it: has it travelled far enough to be a drag, and
 * is it the second half of a double click. Pure decisions over screen points, extracted from
 * the pointer layer so the boundaries have tests.
 */

/**
 * How far the pointer has to travel before a press counts as a drag, in CSS pixels.
 *
 * Without it any press is a drag, because the test for "has this moved" can only be exact:
 * half a pixel of tremor between pointer down and the first move is a real difference. What
 * that costs is not one wasted history step. A gesture that has begun pulls its node out of
 * the auto layout flow so it can float, which is right once the node has visibly detached
 * and wrong while it is still sitting where it was: the siblings close up over it and stay
 * that way for as long as the button is held. Clearing the slop is what makes the reflow
 * follow a movement the eye has already seen.
 *
 * The same number as the double click slop, and for the same underlying reason: below a few
 * pixels a pointer has not gone anywhere on purpose. They stay separate constants because
 * they answer different questions and either could move without the other.
 */
export const DRAG_SLOP = 4

export const DOUBLE_CLICK_MS = 400
export const DOUBLE_CLICK_SLOP = 4

/**
 * Whether a gesture has earned the right to act yet.
 *
 * `latched` is whether it already has: once past the slop a drag stays one, so coming back
 * inside it does not suspend the gesture halfway through.
 */
export function clearedSlop(start: Vec2, screen: Vec2, latched: boolean): boolean {
  return (
    latched ||
    Math.abs(screen.x - start.x) > DRAG_SLOP ||
    Math.abs(screen.y - start.y) > DRAG_SLOP
  )
}

/** The previous press, for the next one to compare against. */
export interface LastClick {
  at: number
  screen: Vec2
}

export function isDoubleClick(last: LastClick | null, screen: Vec2, now: number): boolean {
  if (!last || now - last.at > DOUBLE_CLICK_MS) return false
  return (
    Math.abs(screen.x - last.screen.x) <= DOUBLE_CLICK_SLOP &&
    Math.abs(screen.y - last.screen.y) <= DOUBLE_CLICK_SLOP
  )
}

/** A rect from two corners, in any drag direction. */
export function rectBetween(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}
