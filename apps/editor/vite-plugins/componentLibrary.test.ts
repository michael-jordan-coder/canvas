import { describe, expect, it } from 'vitest'
import { globPatternFor, libraryModuleSource } from './componentLibrary.js'
import type { ComponentMeta } from './extract.js'

/**
 * The two pure halves of what the editor is handed. Tested without a dev server for the same
 * reason `resolveLibraryFile` and `parseWriteRequest` are: what matters is the string, and a
 * running Vite would only prove that Vite runs.
 */

const META: ComponentMeta = {
  key: 'button',
  name: 'Button',
  exportName: 'Button',
  importPath: 'components/library/Button',
  file: '/app/src/components/library/Button.tsx',
  props: [],
}

describe('the glob pattern the virtual module carries', () => {
  /*
   * Root relative, and therefore starting with a slash. Not a style choice: Vite requires it
   * of a glob in a virtual module, since a virtual module has no directory for a relative
   * pattern to resolve against.
   */
  it('is root relative', () => {
    expect(globPatternFor('/app', '/app/src/components/library')).toBe(
      '/src/components/library/*.tsx',
    )
  })

  it('names the folder itself when the root is the folder', () => {
    expect(globPatternFor('/app/src/components/library', '/app/src/components/library')).toBe(
      '//*.tsx',
    )
  })
})

describe('the source of the virtual module', () => {
  const source = libraryModuleSource([META], '/src/components/library/*.tsx')

  it('carries the description as data', () => {
    expect(source).toContain('export const components = ')
    expect(JSON.parse(source.split('\n')[0]?.replace('export const components = ', '') ?? '')).toEqual([
      META,
    ])
  })

  // The line that makes a component file appear without a restart, because it is expanded
  // every time this module is transformed.
  it('carries the modules as a glob over the same folder', () => {
    expect(source).toContain(
      'export const modules = import.meta.glob("/src/components/library/*.tsx", { eager: true })',
    )
  })

  it('sends no component code of its own', () => {
    expect(source).not.toContain('function ')
  })

  it('survives a library with nothing in it', () => {
    expect(libraryModuleSource([], '/x/*.tsx')).toContain('export const components = []')
  })
})
