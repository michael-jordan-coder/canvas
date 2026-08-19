import { describe, expect, it } from 'vitest'
import { parseHex } from './paint.js'

describe('parseHex', () => {
  it('parses a 6 digit hex with a leading #', () => {
    const parsed = parseHex('#ff8800')
    expect(parsed?.color.r).toBeCloseTo(1)
    expect(parsed?.color.g).toBeCloseTo(0x88 / 255)
    expect(parsed?.color.b).toBeCloseTo(0)
  })

  it('parses a 6 digit hex without a leading #', () => {
    expect(parseHex('ff8800')).not.toBeNull()
  })

  it('parses a 3 digit hex, expanding each digit', () => {
    const parsed = parseHex('#f80')
    expect(parsed?.color.r).toBeCloseTo(1)
    expect(parsed?.color.g).toBeCloseTo(0x88 / 255)
    expect(parsed?.color.b).toBeCloseTo(0)
  })

  it('is case insensitive', () => {
    expect(parseHex('#FF8800')).not.toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(parseHex('  #ff8800  ')).not.toBeNull()
  })

  it('rejects the wrong number of digits', () => {
    expect(parseHex('#ff88')).toBeNull()
    expect(parseHex('#ff88000')).toBeNull()
  })

  it('rejects non hex characters', () => {
    expect(parseHex('#gggggg')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(parseHex('')).toBeNull()
  })

  it('carries the alpha argument through', () => {
    expect(parseHex('#ff8800', 0.5)?.color.a).toBe(0.5)
  })
})
