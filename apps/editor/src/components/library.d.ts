/**
 * The library, as the dev server describes it after parsing the source files.
 *
 * Served by `vite-plugins/componentLibrary.ts`, which never sends code across: this is the
 * description of the components, and `import.meta.glob` fetches the components themselves.
 */
declare module 'virtual:component-library' {
  import type { ComponentMeta } from './libraryTypes'
  const library: ComponentMeta[]
  export default library
}
