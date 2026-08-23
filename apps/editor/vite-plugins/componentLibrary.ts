import { readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'
import { extractComponents, type ComponentMeta } from './extract.js'

/**
 * The dev server half of "code is truth": it reads the component library off disk and hands
 * the editor what it found, then does it again whenever a file changes.
 *
 * The editor imports the result as `virtual:component-library`. Nothing is generated into the
 * repo and nothing is written back yet, so the worst this can do is describe a component
 * badly. That is deliberate for the first slice: reading is where the duplication was, and it
 * cannot corrupt anyone's source.
 *
 * The metadata is only half of what the editor needs. The other half is the component
 * function itself, and this module hands both over together: the description as data, and the
 * modules through an `import.meta.glob` in the emitted source, so Vite still owns loading and
 * React Fast Refresh still works. This plugin sends no component code of its own; it sends a
 * glob that Vite expands into real imports.
 *
 * The glob lives here rather than in the app for a reason that only shows up when a file is
 * added. A glob is expanded at transform time, and a glob written in `registry.tsx` could
 * never re-expand: that module accepts this one as a hot dependency, and Vite deliberately
 * does not invalidate an importer that accepts the module which changed, so a new component
 * would arrive as a description with nothing behind it. Emitting the glob here means adding a
 * component invalidates the module the glob is written in, which is the only way it can be
 * expanded again. It also means the description and the modules can no longer be a step apart,
 * since they arrive as two exports of one module.
 */

const VIRTUAL_ID = 'virtual:component-library'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

/**
 * The library folder as a glob pattern, relative to the Vite root.
 *
 * Root relative and therefore starting with `/`, which is not a style choice: Vite requires it
 * of a glob in a virtual module, since a virtual module has no directory for a relative pattern
 * to be resolved against.
 */
export function globPatternFor(root: string, dir: string): string {
  // Posix separators, because this ends up in an import statement rather than on disk.
  const inside = relative(root, dir).split(sep).join('/')
  return `/${inside}/*.tsx`
}

/**
 * The source of the virtual module, which is two exports and no component code.
 *
 * Pure and exported so what the editor is handed can be tested without a dev server, in the
 * style `resolveLibraryFile` and `parseWriteRequest` set for the other plugin.
 */
export function libraryModuleSource(components: ComponentMeta[], pattern: string): string {
  return [
    // Serialised rather than imported, because this crosses from Node into the browser.
    `export const components = ${JSON.stringify(components)}`,
    `export const modules = import.meta.glob(${JSON.stringify(pattern)}, { eager: true })`,
  ].join('\n')
}

export interface ComponentLibraryOptions {
  /** Absolute path to the folder of component source files. */
  dir: string
  /** Absolute path the import specifiers are written relative to, which is the app's `src`. */
  root: string
}

function sourceFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => join(dir, name))
      .sort()
  } catch {
    // A library folder that is not there yet is an empty library, not a broken build.
    return []
  }
}

export function componentLibrary(options: ComponentLibraryOptions): Plugin {
  let cache: ComponentMeta[] | null = null
  let pattern = ''

  const read = (): ComponentMeta[] => {
    if (cache) return cache
    cache = extractComponents(sourceFilesIn(options.dir), {
      // Posix separators, because this ends up in an import statement rather than on disk.
      importPathFor: (file) => relative(options.root, file).split(sep).join('/').replace(/\.tsx$/, ''),
    })
    return cache
  }

  /*
   * Exactly this folder, not anything under it. The same rule and the same reason as
   * `resolveLibraryFile`: the library is scanned one level deep, so a nested file is not one of
   * its components, and a prefix test for `library` also accepts a sibling named
   * `library-secrets`.
   */
  const isLibraryFile = (file: string): boolean =>
    file.endsWith('.tsx') && dirname(file) === options.dir

  return {
    name: 'figma-canvas:component-library',

    configResolved(config) {
      // The pattern is root relative, so it cannot be worked out until the root is known.
      pattern = globPatternFor(config.root, options.dir)
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },

    load(id) {
      if (id !== RESOLVED_ID) return null
      return libraryModuleSource(read(), pattern)
    },

    configureServer(server) {
      // The library folder is inside the project, so Vite already watches it for module
      // changes. This adds the one thing it does not know: that a change in there also
      // invalidates the description of what is in there.
      server.watcher.add(options.dir)
    },

    /**
     * A change to a component file changes both the module and its description, so both go out
     * in the same update. Returning the virtual module alongside the modules Vite already
     * worked out means the editor gets one coherent update rather than a component whose props
     * panel is a step behind it.
     *
     * `hotUpdate` rather than `handleHotUpdate`, and that is the whole of why adding a file
     * used to do nothing: Vite calls the older hook only for `type === 'update'`, so a created
     * or deleted file reached no plugin at all. This one is called for all three. On a create
     * the file is not in the module graph yet, so `context.modules` is empty and the virtual
     * module is the entire update, which is exactly right: re-emitting it re-expands the glob
     * and the new component comes with it.
     *
     * A delete is the one case that drops what Vite worked out rather than adding to it. Those
     * modules are the file that has just gone, and sending them makes the client try to fetch a
     * module that is not there any more, which it reports as a failed reload. The virtual
     * module alone is the whole story: it re-expands without the component, the registry drops
     * the spec, and a node still naming it falls back to the placeholder an unknown key gets.
     */
    hotUpdate(context) {
      if (!isLibraryFile(context.file)) return
      cache = null
      const virtual = this.environment.moduleGraph.getModuleById(RESOLVED_ID)
      if (!virtual) return
      this.environment.moduleGraph.invalidateModule(virtual)
      return context.type === 'delete' ? [virtual] : [...context.modules, virtual]
    },
  }
}
