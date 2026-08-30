import { describe, expect, it } from 'vitest'
import { generateToken, tokenFromUrl, tokensMatch } from './token.ts'

describe('generateToken', () => {
  it('is 64 hex characters', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not repeat, so one run cannot be replayed against the next', () => {
    expect(generateToken()).not.toBe(generateToken())
  })
})

describe('tokensMatch', () => {
  const token = 'a'.repeat(64)

  it('admits the exact token', () => {
    expect(tokensMatch(token, token)).toBe(true)
  })

  it('ignores whitespace around an otherwise exact token', () => {
    expect(tokensMatch(`  ${token}  `, token)).toBe(true)
  })

  it('refuses a token that differs by one character', () => {
    expect(tokensMatch('b' + token.slice(1), token)).toBe(false)
  })

  it('refuses a token of the wrong length', () => {
    expect(tokensMatch(token.slice(0, 63), token)).toBe(false)
    expect(tokensMatch(token + 'a', token)).toBe(false)
  })

  it('refuses a missing or empty presentation, since a real client has the token', () => {
    expect(tokensMatch(undefined, token)).toBe(false)
    expect(tokensMatch('', token)).toBe(false)
    expect(tokensMatch('   ', token)).toBe(false)
  })
})

describe('tokenFromUrl', () => {
  it('reads the token out of the query', () => {
    expect(tokenFromUrl('/?token=abc123')).toBe('abc123')
  })

  it('reads it whatever its position among other params', () => {
    expect(tokenFromUrl('/?first=1&token=abc123&last=2')).toBe('abc123')
  })

  it('is undefined when the URL carries no query', () => {
    expect(tokenFromUrl('/')).toBeUndefined()
    expect(tokenFromUrl(undefined)).toBeUndefined()
  })

  it('is undefined when the query has no token', () => {
    expect(tokenFromUrl('/?other=1')).toBeUndefined()
  })
})
