/**
 * The library, as the dev server describes it after parsing the source files.
 *
 * Served by `vite-plugins/componentLibrary.ts`, which sends no component code of its own: the
 * description as data, and a glob that Vite expands into real imports of the components. Two
 * exports of one module rather than two modules, so a component added while the editor is
 * running arrives as both halves at once.
 */
declare module 'virtual:component-library' {
  import type { ComponentMeta } from './libraryTypes'
  export const components: ComponentMeta[]
  export const modules: Record<string, Record<string, unknown>>
}
