import { describe, expect, it } from 'vitest'
import {
  CARD_MAX_HEIGHT,
  CARD_MAX_WIDTH,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  clampCardSize,
} from './cardSize'

describe('clampCardSize', () => {
  it('passes a size already in range through untouched', () => {
    expect(clampCardSize({ width: 400, height: 500 })).toEqual({ width: 400, height: 500 })
  })

  it('clamps each axis on its own, so a corner drag still moves the axis that can move', () => {
    expect(clampCardSize({ width: 10_000, height: 300 })).toEqual({
      width: CARD_MAX_WIDTH,
      height: 300,
    })
    expect(clampCardSize({ width: 400, height: 10 })).toEqual({
      width: 400,
      height: CARD_MIN_HEIGHT,
    })
  })

  it('holds the minimum when the pointer drags past the anchored corner', () => {
    // Dragging right past the card's own right edge gives a negative width.
    expect(clampCardSize({ width: -120, height: -40 })).toEqual({
      width: CARD_MIN_WIDTH,
      height: CARD_MIN_HEIGHT,
    })
  })

  it('holds the maximum', () => {
    expect(clampCardSize({ width: 900, height: 900 })).toEqual({
      width: CARD_MAX_WIDTH,
      height: CARD_MAX_HEIGHT,
    })
  })
})
