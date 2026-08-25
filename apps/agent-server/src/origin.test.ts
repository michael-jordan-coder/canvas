import { describe, expect, it } from 'vitest'
import {
  EDITOR_DEV_ORIGINS,
  allowedOrigins,
  isOriginAllowed,
  parseAllowedOrigins,
} from './origin.ts'

const dev = allowedOrigins(undefined)

describe('isOriginAllowed', () => {
  it('admits the editor in dev, by either spelling of the host', () => {
    expect(isOriginAllowed('http://localhost:5173', dev)).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:5173', dev)).toBe(true)
  })

  // The built editor is the same editor, and it is previewed here as often as it is run in
  // dev. Left out, the refusal would land on a production build and read as a broken
  // assistant rather than as an origin nobody listed.
  it('admits the editor under vite preview too', () => {
    expect(isOriginAllowed('http://localhost:4173', dev)).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:4173', dev)).toBe(true)
  })

  it('refuses a page nobody listed', () => {
    expect(isOriginAllowed('https://evil.example', dev)).toBe(false)
  })

  it('refuses a missing Origin, since the only legitimate client always sends one', () => {
    expect(isOriginAllowed(undefined, dev)).toBe(false)
  })

  it('refuses an empty Origin, including one that is only whitespace', () => {
    expect(isOriginAllowed('', dev)).toBe(false)
    expect(isOriginAllowed('   ', dev)).toBe(false)
  })

  it('compares whole strings, so a listed origin cannot be used as a prefix', () => {
    expect(isOriginAllowed('http://localhost:5173.evil.com', dev)).toBe(false)
    expect(isOriginAllowed('http://localhost:51730', dev)).toBe(false)
    expect(isOriginAllowed('http://evil.com/http://localhost:5173', dev)).toBe(false)
  })

  it('refuses the right host on the wrong scheme or port', () => {
    expect(isOriginAllowed('https://localhost:5173', dev)).toBe(false)
    expect(isOriginAllowed('http://localhost:5174', dev)).toBe(false)
  })

  it('ignores whitespace around an otherwise exact match', () => {
    expect(isOriginAllowed('  http://localhost:5173  ', dev)).toBe(true)
  })
})

describe('parseAllowedOrigins', () => {
  it('is empty when the variable is unset or blank', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([])
    expect(parseAllowedOrigins('')).toEqual([])
    expect(parseAllowedOrigins('  ')).toEqual([])
  })

  it('splits on commas and trims each entry', () => {
    expect(parseAllowedOrigins('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  it('drops empty entries, so a trailing comma is not an origin', () => {
    expect(parseAllowedOrigins('https://a.example,,  ,https://b.example,')).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })
})

describe('allowedOrigins', () => {
  it('keeps the dev origins whether or not the environment adds any', () => {
    expect(allowedOrigins(undefined)).toEqual([...EDITOR_DEV_ORIGINS])
    expect(allowedOrigins('https://canvas.example')).toEqual([
      ...EDITOR_DEV_ORIGINS,
      'https://canvas.example',
    ])
  })

  it('admits a deployed host once it is listed, and nothing near it', () => {
    const allowed = allowedOrigins(' https://canvas.example ')
    expect(isOriginAllowed('https://canvas.example', allowed)).toBe(true)
    expect(isOriginAllowed('https://canvas.example.evil.com', allowed)).toBe(false)
  })
})
