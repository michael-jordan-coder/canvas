import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'

/**
 * Serving a component's own source to the editor.
 *
 * This is the first thing in the project that lets the browser reach the repo, so the whole
 * design is about what it refuses. It exists only under `vite dev`, because the plugin that
 * installs it declares `apply: 'serve'`, and it answers for exactly one directory: the
 * component library the editor already parses.
 */

/** The route, double underscored like Vite's own internals so an app path cannot collide. */
export const SOURCE_ROUTE = '/__component-source'

/**
 * The absolute path a request is allowed to read, or null.
 *
 * Pure and exported so the guard can be tested on its own, without a server. Every rule has to
 * pass, and the order matters:
 *
 * 1. No null byte. It truncates a path inside some syscalls, so a name that looks safe here
 *    can name a different file by the time it is opened.
 * 2. Resolve first. That normalises away every `..` before anything is compared, so a
 *    traversal cannot survive into the comparison below.
 * 3. `.tsx` only. The library is TypeScript components and nothing else, which on its own puts
 *    `package.json`, `.env` and `vite.config.ts` out of reach.
 * 4. Resolve the file itself through symlinks, and answer about where it actually goes. This
 *    is the rule that is easy to get subtly wrong: resolving only the containing directory
 *    lets a symlink sitting inside the library point anywhere at all, because the directory
 *    is the library and the link is never followed. A test for exactly that caught this.
 * 5. The real file's directory must be exactly the library. Exact rather than a prefix test
 *    because the library is scanned one level deep, so a nested file is not a library file,
 *    and because a prefix test for `library` also accepts a sibling named `library-secrets`.
 *    If the scan ever goes recursive this becomes `startsWith(realpath(dir) + sep)`, and the
 *    trailing separator is not optional for that same reason.
 * 6. It must be a file that already exists. This endpoint reads the library, it does not
 *    discover the filesystem.
 */
export function resolveLibraryFile(dir: string, requested: string): string | null {
  if (requested.length === 0 || requested.includes('\0')) return null

  const target = resolve(requested)
  if (extname(target) !== '.tsx') return null

  try {
    // Follows every link in the path and the final entry with it, so this is where the read
    // would actually land rather than where it was addressed.
    const real = realpathSync(target)
    // Checked again on the real path: a link named `Button.tsx` pointing at `.env` passes an
    // extension test on the name it was asked by.
    if (extname(real) !== '.tsx') return null
    if (dirname(real) !== realpathSync(dir)) return null
    if (!statSync(real).isFile()) return null
    return real
  } catch {
    // A missing file, a broken link, or no permission. All of them mean no.
    return null
  }
}

function send(response: Parameters<Connect.NextHandleFunction>[1], status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  // The whole point is that it reflects the file on disk right now.
  response.setHeader('Cache-Control', 'no-store')
  response.end(text)
}

/**
 * Reads one library file.
 *
 * `GET /__component-source?file=<absolute path>` answers `{ file, text, mtimeMs }`. The stamp
 * is what a later write sends back to prove it is editing the version it was given, so a file
 * changed by something else in the meantime is not silently overwritten.
 *
 * The path the browser sends is `ComponentSpec.file`, which the extractor put there. It is
 * still treated as untrusted, because it arrived over HTTP.
 */
export function componentSourceMiddleware(dir: string): Connect.NextHandleFunction {
  return (request, response, next) => {
    if (request.method !== 'GET') {
      next()
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')
    const requested = url.searchParams.get('file')
    if (!requested) {
      send(response, 400, { error: 'no-file' })
      return
    }

    const file = resolveLibraryFile(dir, requested)
    // Deliberately says nothing about why, and never echoes the path back: a refusal should
    // not be a way to ask whether a file exists.
    if (!file) {
      send(response, 403, { error: 'outside-library' })
      return
    }

    try {
      send(response, 200, {
        file,
        text: readFileSync(file, 'utf8'),
        mtimeMs: statSync(file).mtimeMs,
      })
    } catch {
      send(response, 500, { error: 'read-failed' })
    }
  }
}

/**
 * The plugin that installs the route.
 *
 * Its own plugin rather than a hook on the library one, and the reason is worth stating: the
 * library plugin also serves `virtual:component-library`, which the production build needs to
 * resolve the registry, so it cannot be dev only. This one can, and `apply: 'serve'` is what
 * keeps the endpoint out of a build entirely rather than a flag someone could get wrong. There
 * is deliberately no `configurePreviewServer`, so `vite preview` has no route either.
 */
export function componentSource(options: { dir: string }): Plugin {
  return {
    name: 'figma-canvas:component-source',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(SOURCE_ROUTE, componentSourceMiddleware(options.dir))
    },
  }
}
