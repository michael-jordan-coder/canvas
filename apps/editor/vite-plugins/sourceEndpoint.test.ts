import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseWriteRequest, resolveLibraryFile } from './sourceEndpoint.js'

/**
 * The path guard is the only new code in this feature that can reach outside the app, so it
 * gets the most tests. Real files in a real temp directory rather than a mocked filesystem,
 * in the style `extract.test.ts` already sets, because the rule being tested is about
 * symlinks and canonical paths and a mock would only prove the mock agrees with itself.
 */

const roots: string[] = []

function library(): { dir: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), 'source-endpoint-'))
  roots.push(root)
  const dir = join(root, 'library')
  mkdirSync(dir)
  writeFileSync(join(dir, 'Button.tsx'), 'export function Button() { return null }')
  writeFileSync(join(dir, 'notes.md'), 'not a component')
  mkdirSync(join(dir, 'nested'))
  writeFileSync(join(dir, 'nested', 'Deep.tsx'), 'export function Deep() { return null }')

  // Things that exist beside the library and must stay out of reach.
  writeFileSync(join(root, 'secrets.tsx'), 'const token = 1')
  mkdirSync(join(root, 'library-secrets'))
  writeFileSync(join(root, 'library-secrets', 'Sneaky.tsx'), 'const token = 2')

  return { dir, outside: root }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('what the source endpoint will read', () => {
  it('resolves a component in the library', () => {
    const { dir } = library()
    expect(resolveLibraryFile(dir, join(dir, 'Button.tsx'))).toBe(join(dir, 'Button.tsx'))
  })

  it('refuses a traversal out of the library', () => {
    const { dir } = library()
    expect(resolveLibraryFile(dir, join(dir, '..', 'secrets.tsx'))).toBeNull()
    expect(resolveLibraryFile(dir, `${dir}/../../../etc/passwd`)).toBeNull()
  })

  it('refuses an absolute path somewhere else entirely', () => {
    const { dir, outside } = library()
    expect(resolveLibraryFile(dir, join(outside, 'secrets.tsx'))).toBeNull()
  })

  /*
   * The reason the check is an exact directory match rather than a string prefix. A prefix
   * test for `/x/library` accepts `/x/library-secrets/Sneaky.tsx`, which is a different
   * directory that merely starts the same way.
   */
  it('refuses a sibling directory whose name merely starts the same way', () => {
    const { dir, outside } = library()
    expect(resolveLibraryFile(dir, join(outside, 'library-secrets', 'Sneaky.tsx'))).toBeNull()
  })

  it('refuses a file that is not a component, even inside the library', () => {
    const { dir } = library()
    expect(resolveLibraryFile(dir, join(dir, 'notes.md'))).toBeNull()
  })

  // The library is scanned one level deep, so a nested file is not one of its components.
  it('refuses a file in a subdirectory of the library', () => {
    const { dir } = library()
    expect(resolveLibraryFile(dir, join(dir, 'nested', 'Deep.tsx'))).toBeNull()
  })

  it('refuses a file that does not exist', () => {
    const { dir } = library()
    expect(resolveLibraryFile(dir, join(dir, 'Missing.tsx'))).toBeNull()
  })

  it('refuses a directory named like a component', () => {
    const { dir } = library()
    mkdirSync(join(dir, 'Folder.tsx'))
    expect(resolveLibraryFile(dir, join(dir, 'Folder.tsx'))).toBeNull()
  })

  it('refuses a path carrying a null byte, which can truncate on the way to a syscall', () => {
    const { dir } = library()
    expect(resolveLibraryFile(dir, `${join(dir, 'Button.tsx')}\0.png`)).toBeNull()
  })

  it('refuses nothing at all', () => {
    const { dir } = library()
    expect(resolveLibraryFile(dir, '')).toBeNull()
  })

  /*
   * The one case a prefix test cannot catch however carefully it is written: the path really
   * is inside the library, and the file really is not.
   */
  it('refuses a symlink inside the library that points out of it', () => {
    const { dir, outside } = library()
    const link = join(dir, 'Escape.tsx')
    try {
      symlinkSync(join(outside, 'secrets.tsx'), link)
    } catch {
      // Some filesystems and sandboxes refuse symlinks. Nothing to assert if it did not happen.
      return
    }
    expect(resolveLibraryFile(dir, link)).toBeNull()
  })
})

/*
 * The other thing standing between an HTTP body and a file on disk. Nothing is coerced, and
 * the stamp is the reason: a `mtimeMs` accepted as a string would never equal the number on
 * disk, so every save would come back as a conflict, which is a far more confusing failure
 * than a refusal to parse.
 */
describe('what the source endpoint will write', () => {
  it('reads a well formed body', () => {
    expect(parseWriteRequest('{"file":"/a/B.tsx","text":"x","mtimeMs":12}')).toEqual({
      file: '/a/B.tsx',
      text: 'x',
      mtimeMs: 12,
    })
  })

  it('keeps an empty file, which is a real thing to write', () => {
    expect(parseWriteRequest('{"file":"/a/B.tsx","text":"","mtimeMs":0}')?.text).toBe('')
  })

  it('refuses a body that is not JSON at all', () => {
    expect(parseWriteRequest('not json')).toBeNull()
    expect(parseWriteRequest('')).toBeNull()
  })

  it('refuses JSON that is not an object', () => {
    expect(parseWriteRequest('null')).toBeNull()
    expect(parseWriteRequest('[1,2]')).toBeNull()
    expect(parseWriteRequest('"a string"')).toBeNull()
  })

  it('refuses a missing field', () => {
    expect(parseWriteRequest('{"text":"x","mtimeMs":1}')).toBeNull()
    expect(parseWriteRequest('{"file":"/a/B.tsx","mtimeMs":1}')).toBeNull()
    expect(parseWriteRequest('{"file":"/a/B.tsx","text":"x"}')).toBeNull()
  })

  it('refuses a stamp sent as a string, rather than coercing it', () => {
    expect(parseWriteRequest('{"file":"/a/B.tsx","text":"x","mtimeMs":"12"}')).toBeNull()
  })

  // Both pass a typeof test and neither can ever equal a stamp on disk.
  it('refuses a stamp that is not a finite number', () => {
    expect(parseWriteRequest('{"file":"/a/B.tsx","text":"x","mtimeMs":null}')).toBeNull()
    expect(parseWriteRequest('{"file":"/a/B.tsx","text":"x","mtimeMs":1e999}')).toBeNull()
  })

  it('refuses an empty path', () => {
    expect(parseWriteRequest('{"file":"","text":"x","mtimeMs":1}')).toBeNull()
  })
})
