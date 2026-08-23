/**
 * What the dev server says about a component, and the only thing that crosses between it and
 * the browser.
 *
 * Its own file, with no imports at all, because both sides need it and neither should reach
 * into the other: the plugin runs in Node against the TypeScript compiler, the app runs in a
 * browser against React, and a shared type is the whole of what they have in common. It is a
 * wire format, so it holds nothing that cannot be serialised.
 */

/** What a prop can be edited as, which is what decides the control the panel renders. */
export type PropKind = 'text' | 'number' | 'boolean' | 'select'

export interface PropMeta {
  key: string
  /** The prop name, humanised. `defaultOpen` reads as "Default open". */
  label: string
  kind: PropKind
  /** `select` only, in declaration order, which is the order the union is written in. */
  options?: string[]
  /**
   * Read from the destructuring default in the component's own signature, which is where a
   * React component actually states what it does when it is told nothing.
   */
  default?: string | number | boolean
  optional: boolean
}

export interface ComponentMeta {
  /** Stored in the document. The export name lowercased, so it survives a rename of the file. */
  key: string
  name: string
  exportName: string
  /** Module specifier a generated file would import from, relative to the app's `src`. */
  importPath: string
  /** Absolute path on disk. Kept for the write-back half, which needs somewhere to write. */
  file: string
  props: PropMeta[]
  /**
   * From an optional `export const canvasDefaults = { width: 220 }` in the component's file.
   *
   * Whether a component is laid out by its width is a fact about the component, so it is
   * declared in the component's own source rather than in a table beside it. Absent means the
   * component is measured at its natural size on both axes.
   */
  defaultWidth?: number
}
