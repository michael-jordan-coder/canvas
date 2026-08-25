import { describe, expect, it } from 'vitest'
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS, reconnectDelay } from './reconnect'

describe('reconnectDelay', () => {
  it('starts at the base and doubles', () => {
    expect(reconnectDelay(0)).toBe(RECONNECT_BASE_MS)
    expect(reconnectDelay(1)).toBe(2000)
    expect(reconnectDelay(3)).toBe(8000)
  })

  it('caps rather than growing without end', () => {
    expect(reconnectDelay(10)).toBe(RECONNECT_MAX_MS)
    expect(reconnectDelay(1000)).toBe(RECONNECT_MAX_MS)
  })

  it('treats a nonsense attempt as the first one', () => {
    expect(reconnectDelay(-5)).toBe(RECONNECT_BASE_MS)
  })
})
