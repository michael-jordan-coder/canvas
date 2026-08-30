import { describe, expect, it } from 'vitest'
import {
  DOUBLE_CLICK_MS,
  DRAG_SLOP,
  clearedSlop,
  isDoubleClick,
  rectBetween,
} from './clickIntent'

describe('clearedSlop', () => {
  const start = { x: 100, y: 100 }

  it('holds a press that has not moved', () => {
    expect(clearedSlop(start, { x: 100, y: 100 }, false)).toBe(false)
  })

  it('holds tremor inside the slop, exactly at the boundary included', () => {
    expect(clearedSlop(start, { x: 100 + DRAG_SLOP, y: 100 }, false)).toBe(false)
    expect(clearedSlop(start, { x: 100, y: 100 - DRAG_SLOP }, false)).toBe(false)
  })

  it('clears one pixel past the slop, on either axis', () => {
    expect(clearedSlop(start, { x: 100 + DRAG_SLOP + 1, y: 100 }, false)).toBe(true)
    expect(clearedSlop(start, { x: 100, y: 100 - DRAG_SLOP - 1 }, false)).toBe(true)
  })

  it('stays cleared once latched, even back at the start point', () => {
    expect(clearedSlop(start, start, true)).toBe(true)
  })
})

describe('isDoubleClick', () => {
  const first = { at: 1000, screen: { x: 50, y: 50 } }

  it('is never a double click with no previous press', () => {
    expect(isDoubleClick(null, { x: 50, y: 50 }, 1100)).toBe(false)
  })

  it('pairs a second press close in time and place', () => {
    expect(isDoubleClick(first, { x: 52, y: 48 }, 1200)).toBe(true)
  })

  it('accepts the window boundary and refuses one past it', () => {
    expect(isDoubleClick(first, { x: 50, y: 50 }, 1000 + DOUBLE_CLICK_MS)).toBe(true)
    expect(isDoubleClick(first, { x: 50, y: 50 }, 1000 + DOUBLE_CLICK_MS + 1)).toBe(false)
  })

  it('refuses a second press that landed too far away', () => {
    expect(isDoubleClick(first, { x: 55, y: 50 }, 1100)).toBe(false)
  })
})

describe('rectBetween', () => {
  it('is the same rect whichever corner the drag started from', () => {
    const expected = { x: 10, y: 20, width: 30, height: 40 }
    expect(rectBetween({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected)
    expect(rectBetween({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected)
    expect(rectBetween({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(expected)
  })

  it('collapses to a zero sized rect at a point', () => {
    expect(rectBetween({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    })
  })
})
