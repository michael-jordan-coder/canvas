import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
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
 * function itself, which the app picks up with `import.meta.glob` over the same folder, so
 * Vite owns module loading and React Fast Refresh keeps working. This plugin never sends code
 * across; it sends the description of it.
 */

const VIRTUAL_ID = 'virtual:component-library'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

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

  const read = (): ComponentMeta[] => {
    if (cache) return cache
    cache = extractComponents(sourceFilesIn(options.dir), {
      // Posix separators, because this ends up in an import statement rather than on disk.
      importPathFor: (file) => relative(options.root, file).split(sep).join('/').replace(/\.tsx$/, ''),
    })
    return cache
  }

  const isLibraryFile = (file: string): boolean =>
    file.endsWith('.tsx') && file.startsWith(options.dir)

  return {
    name: 'figma-canvas:component-library',

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },

    load(id) {
      if (id !== RESOLVED_ID) return null
      // Serialised rather than imported, because this crosses from Node into the browser.
      return `export default ${JSON.stringify(read())}`
    },

    configureServer(server) {
      // The library folder is inside the project, so Vite already watches it for module
      // changes. This adds the one thing it does not know: that a change in there also
      // invalidates the description of what is in there.
      server.watcher.add(options.dir)
    },

    /**
     * A change to a component file changes both the module and its description, so both go
     * out in the same update. Returning the virtual module alongside the modules Vite already
     * worked out means the editor gets one coherent update rather than a component whose
     * props panel is a step behind it.
     */
    handleHotUpdate(context) {
      if (!isLibraryFile(context.file)) return
      cache = null
      const virtual = context.server.moduleGraph.getModuleById(RESOLVED_ID)
      if (!virtual) return
      context.server.moduleGraph.invalidateModule(virtual)
      return [...context.modules, virtual]
    },
  }
}
