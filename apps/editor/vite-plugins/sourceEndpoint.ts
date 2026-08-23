import { readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'

/**
 * Serving a component's own source to the editor.
 *
 * This is the first thing in the project that lets the browser reach the repo, and now the
 * first thing that writes to it, so the whole design is about what it refuses. It exists only
 * under `vite dev`, because the plugin that installs it declares `apply: 'serve'`, and it
 * answers for exactly one directory: the component library the editor already parses.
 *
 * A write passes every check a read does and two more: it must carry the `mtimeMs` it was
 * handed, which is what turns an edit made elsewhere in the meantime into a refusal rather
 * than a silent overwrite, and it lands through a temporary file and a rename, so a crash
 * midway cannot leave a component half written. That second one matters more here than in an
 * ordinary editor, because this file is watched: a partial write is parsed, fails, and takes
 * every instance of the component off the canvas.
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

/**
 * The largest write this accepts, which is far beyond any component and far below anything
 * that could exhaust the dev server's memory. The body is refused as it arrives rather than
 * after it lands, so an unbounded upload is stopped rather than buffered and then rejected.
 */
const MAX_BODY = 512 * 1024

/** What a write has to say for itself. */
export interface WriteRequest {
  file: string
  text: string
  /** The stamp the client was handed by the read it is editing the result of. */
  mtimeMs: number
}

/**
 * A parsed write body, or null.
 *
 * Pure, and exported for its tests, for the same reason the path guard is: this is the shape
 * check standing between an HTTP body and a file on disk. Nothing is coerced. A `mtimeMs` sent
 * as a string would compare unequal to the number on disk and turn every save into a conflict,
 * which is a far more confusing failure than a refusal to parse.
 */
export function parseWriteRequest(body: string): WriteRequest | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const { file, text, mtimeMs } = candidate
  if (typeof file !== 'string' || file.length === 0) return null
  if (typeof text !== 'string') return null
  // A non-finite stamp would pass a typeof test and never equal anything on disk.
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return null
  return { file, text, mtimeMs }
}

/** Collects the body, or gives up the moment it is larger than a component could be. */
function readBody(request: Parameters<Connect.NextHandleFunction>[0]): Promise<string | null> {
  return new Promise((resolve_) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        /*
         * Stop reading rather than keep accumulating something already refused. Paused and
         * not destroyed: destroying the request takes the socket, and with it the 413 that
         * has not been written yet, so the client would see the connection drop rather than
         * the reason. The caller answers first and closes after.
         */
        request.pause()
        resolve_(null)
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve_(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => resolve_(null))
  })
}

/**
 * Writes a component file, atomically as far as the filesystem allows.
 *
 * The text goes to a temporary neighbour and is renamed over the target, because `rename`
 * within one directory is atomic: a reader sees the old file or the new one and never a
 * half written one. Writing in place would give a watcher a window in which the component is
 * syntactically incomplete, and the extractor parsing it in that window fails and takes every
 * instance off the canvas.
 *
 * The temporary name deliberately does not end in `.tsx`, so the library scan and this
 * endpoint's own guard both ignore it while it exists.
 */
function writeAtomically(file: string, text: string): void {
  const temporary = join(dirname(file), `.${Date.now()}-${process.pid}.tsx.tmp`)
  try {
    writeFileSync(temporary, text, 'utf8')
    renameSync(temporary, file)
  } catch (cause) {
    rmSync(temporary, { force: true })
    throw cause
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
    if (request.method === 'POST') {
      void handleWrite(dir, request, response)
      return
    }
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
 * Writes one library file.
 *
 * `POST /__component-source` with `{ file, text, mtimeMs }`. The stamp has to match the file
 * on disk: if it does not, the file changed since the editor read it and the answer is a 409
 * carrying the current stamp, not a write. The panel keeps what was typed, so a conflict costs
 * a re read rather than the edit.
 *
 * There is no way to create a file here and that is deliberate: the guard only resolves paths
 * that already exist, so this endpoint can change a component and cannot add one.
 */
async function handleWrite(
  dir: string,
  request: Parameters<Connect.NextHandleFunction>[0],
  response: Parameters<Connect.NextHandleFunction>[1],
): Promise<void> {
  const body = await readBody(request)
  if (body === null) {
    /*
     * The rest of the body is never read, so the connection cannot be reused: it still holds
     * whatever was not consumed. The answer is written first and the socket dropped once it
     * has actually gone out, which is what the callback on `end` is for.
     */
    response.statusCode = 413
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Connection', 'close')
    response.end(JSON.stringify({ error: 'too-large' }), () => request.destroy())
    return
  }

  const write = parseWriteRequest(body)
  if (!write) {
    send(response, 400, { error: 'unreadable-body' })
    return
  }

  const file = resolveLibraryFile(dir, write.file)
  // Says nothing about why, exactly as the read does.
  if (!file) {
    send(response, 403, { error: 'outside-library' })
    return
  }

  try {
    const current = statSync(file).mtimeMs
    if (current !== write.mtimeMs) {
      send(response, 409, { error: 'stale', mtimeMs: current })
      return
    }
    writeAtomically(file, write.text)
    // The new stamp, so the panel can save again without reading the file back first.
    send(response, 200, { file, mtimeMs: statSync(file).mtimeMs })
  } catch {
    send(response, 500, { error: 'write-failed' })
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
