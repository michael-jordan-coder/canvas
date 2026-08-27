import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  clampPanelWidth,
} from './panelSize'

describe('clampPanelWidth', () => {
  it('leaves a width between the bounds alone', () => {
    expect(clampPanelWidth(320, PANEL_MIN_WIDTH)).toBe(320)
  })

  it('holds the floor it is given', () => {
    expect(clampPanelWidth(100, PANEL_MIN_WIDTH)).toBe(PANEL_MIN_WIDTH)
    expect(clampPanelWidth(100, ASSISTANT_MIN_WIDTH)).toBe(ASSISTANT_MIN_WIDTH)
  })

  // The point of the minimum being an argument: the same drag stops in two places.
  it('stops a panel holding the conversation wider than one holding fields', () => {
    expect(clampPanelWidth(260, ASSISTANT_MIN_WIDTH)).toBeGreaterThan(
      clampPanelWidth(260, PANEL_MIN_WIDTH),
    )
  })

  it('holds the ceiling', () => {
    expect(clampPanelWidth(9000, PANEL_MIN_WIDTH)).toBe(PANEL_MAX_WIDTH)
  })
})
