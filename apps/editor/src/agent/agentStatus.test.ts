import { describe, expect, it } from 'vitest'
import { isConnected, isWorking, type AgentStatus } from './agentStore'

const ALL: AgentStatus[] = ['offline', 'connecting', 'idle', 'busy', 'stopping', 'displaced']

describe('isWorking', () => {
  it('is the two states a turn is running in, and nothing else', () => {
    expect(ALL.filter(isWorking)).toEqual(['busy', 'stopping'])
  })
})

describe('isConnected', () => {
  it('is every state that can send, and nothing else', () => {
    expect(ALL.filter(isConnected)).toEqual(['idle', 'busy', 'stopping'])
  })

  // Displaced is reachable and idle-looking, which is exactly why it is worth pinning: the
  // composer must not offer to send into a socket another tab now holds.
  it('does not count displaced as connected', () => {
    expect(isConnected('displaced')).toBe(false)
    expect(isWorking('displaced')).toBe(false)
  })
})
