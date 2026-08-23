import { createElement, useSyncExternalStore, type ComponentType, type ReactElement } from 'react'
import type { ComponentPropValue, Size } from '@figma-canvas/document'
import { components, modules as initialModules } from 'virtual:component-library'
import type { ComponentMeta, PropMeta } from './libraryTypes'

/**
 * The component library, read from the source files rather than written out here.
 *
 * This file used to hold the list: three components, each with its props, their kinds, their
 * options and their defaults, all hand maintained. Every one of those facts is already stated
 * in the component's own signature, and two records of one fact drift. A variant added to
 * `ButtonVariant` would have shown up in TypeScript, in autocomplete and in the component's
 * behaviour, and nowhere in the panel offering it.
 *
 * So the panel is generated now. The dev server parses the library with a real type checker
 * and serves the result as `virtual:component-library`, which carries both halves: the
 * description as data, and the modules through a glob that Vite expands into real imports, so
 * Vite owns loading and React Fast Refresh still works. Editing a component's props type
 * updates the panel without touching this file, and there is no list here to forget to update.
 *
 * The two halves arriving together is what lets a component file be added or removed while the
 * editor is running. It also means they cannot be a step apart, which two separate modules
 * could be.
 */

export type { PropKind, PropMeta } from './libraryTypes'

export interface ComponentSpec {
  /** Stored in the document. The export name lowercased, so it survives a rename of the file. */
  key: string
  name: string
  /** Where a generated file would import this from, relative to the app's `src`. */
  importPath: string
  exportName: string
  /** Absolute path on disk, which is what a write back will need. */
  file: string
  props: readonly PropMeta[]
  /** The boundary where the document's scalars become typed React props. */
  render: (props: Record<string, ComponentPropValue>) => ReactElement
  /** Used where there is no DOM to measure in, which in practice means a test. */
  fallbackSize: Size
  /**
   * Present when the component is laid out by its width: it fills what it is given and its
   * height follows. Declared by the component itself, as `export const canvasDefaults`.
   */
  defaultWidth?: number
}

/**
 * The modules themselves, which arrive with the description rather than being fetched here.
 *
 * Eager, because the editor mounts a component the moment a saved document names one and a
 * lazy import would leave a hole on the canvas for a frame. Vite expands the glob into real
 * static imports, so Fast Refresh treats them exactly as if they had been imported by name.
 */
type LibraryModules = Record<string, Record<string, unknown>>

/** A component whose size is entirely its own content still needs a number where there is no DOM. */
const FALLBACK_SIZE: Size = { width: 120, height: 40 }

/**
 * The document holds scalars and a React component holds types, and this is the only place
 * that crosses between them.
 *
 * A value that does not match what the source says the prop is gets dropped rather than
 * coerced, so the component falls back to its own default. That case is a saved file naming a
 * variant this build no longer has, and a component is the wrong place to find that out.
 */
function coerce(
  props: Record<string, ComponentPropValue>,
  meta: readonly PropMeta[],
): Record<string, ComponentPropValue> {
  const typed: Record<string, ComponentPropValue> = {}
  for (const prop of meta) {
    const value = props[prop.key]
    if (value === undefined) continue
    switch (prop.kind) {
      case 'text':
        if (typeof value === 'string') typed[prop.key] = value
        break
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) typed[prop.key] = value
        break
      case 'boolean':
        if (typeof value === 'boolean') typed[prop.key] = value
        break
      case 'select':
        if (typeof value === 'string' && prop.options?.includes(value)) typed[prop.key] = value
        break
    }
  }
  return typed
}

/** The component function a piece of metadata describes, or undefined if the module is gone. */
function componentFor(
  meta: ComponentMeta,
  modules: LibraryModules,
): ComponentType<never> | undefined {
  const suffix = `/${meta.file.split('/').pop() ?? ''}`
  for (const [path, module] of Object.entries(modules)) {
    if (!path.endsWith(suffix)) continue
    const exported = module[meta.exportName]
    if (typeof exported === 'function') return exported as ComponentType<never>
  }
  return undefined
}

function toSpec(meta: ComponentMeta, modules: LibraryModules): ComponentSpec | null {
  const Component = componentFor(meta, modules)
  // Metadata without a module means the file was deleted between the parse and the load.
  // Skipping it leaves the node rendering the same placeholder an unknown key gets.
  if (!Component) return null

  return {
    key: meta.key,
    name: meta.name,
    importPath: meta.importPath,
    exportName: meta.exportName,
    file: meta.file,
    props: meta.props,
    fallbackSize: meta.defaultWidth
      ? { width: meta.defaultWidth, height: FALLBACK_SIZE.height }
      : FALLBACK_SIZE,
    ...(meta.defaultWidth !== undefined ? { defaultWidth: meta.defaultWidth } : {}),
    render: (props) => createElement(Component, coerce(props, meta.props) as never),
  }
}

/*
 * Mutable module state, read through the functions below rather than exported directly.
 *
 * Hot replacing the library has to be visible to everything already holding a spec, and a
 * consumer that had destructured an array would be holding the old one. Reading through a
 * function is what lets the list change under them.
 */
let specs: ComponentSpec[] = []
let byKey = new Map<string, ComponentSpec>()
let revision = 0
const listeners = new Set<() => void>()

function rebuild(source: readonly ComponentMeta[], modules: LibraryModules): void {
  specs = source
    .map((meta) => toSpec(meta, modules))
    .filter((spec): spec is ComponentSpec => spec !== null)
  byKey = new Map(specs.map((spec) => [spec.key, spec]))
  revision += 1
}

rebuild(components, initialModules)

/** In the order the files sort, which is the order the panel lists them. */
export function componentSpecs(): readonly ComponentSpec[] {
  return specs
}

/**
 * The spec for a key, or undefined.
 *
 * Undefined is a real answer rather than an error: a saved file can name a component that has
 * since been renamed or deleted, and losing the node would be worse than showing a placeholder
 * where it sits.
 */
export function componentSpec(key: string): ComponentSpec | undefined {
  return byKey.get(key)
}

/** What a freshly dropped instance carries, so every editable prop starts with a value. */
export function defaultProps(spec: ComponentSpec): Record<string, ComponentPropValue> {
  const props: Record<string, ComponentPropValue> = {}
  for (const prop of spec.props) {
    if (prop.default !== undefined) props[prop.key] = prop.default
  }
  return props
}

/**
 * Notified when the library on disk changes.
 *
 * The canvas and the panels are already mounted when a component's source is edited, and
 * neither reads the registry during a React render it can be made to repeat. This is how they
 * are told to look again.
 */
export function subscribeToLibrary(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * How many times the library has been read. A value React can compare, for the same reason
 * the scene keeps a revision per node rather than handing components the node itself.
 */
export function libraryRevision(): number {
  return revision
}

/** Re-renders the caller when a component's source changes on disk. */
export function useLibrary(): number {
  return useSyncExternalStore(subscribeToLibrary, libraryRevision, libraryRevision)
}

/*
 * Accepting the metadata module rather than being replaced by it.
 *
 * This makes the registry the hot boundary: when the description of the library changes, this
 * module stays put and updates its own state, so everything holding a reference to
 * `componentSpec` keeps working and simply sees new answers. Being replaced instead would
 * leave the canvas and the panel calling into a module nothing writes to any more, which is
 * the same reason `document.load` replaces the scene in place.
 */
if (import.meta.hot) {
  import.meta.hot.accept('virtual:component-library', (updated) => {
    const next = updated as
      | { components?: ComponentMeta[]; modules?: LibraryModules }
      | undefined
    // Both halves or neither. A component added since the last update is only in this
    // module's own glob, so pairing a new description with the old modules would drop it.
    if (!next?.components || !next.modules) return
    rebuild(next.components, next.modules)
    for (const listener of listeners) listener()
  })
}
