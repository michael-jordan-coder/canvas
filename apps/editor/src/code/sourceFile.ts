/**
 * Reading a component's own source from the dev server.
 *
 * The route only exists under `vite dev`, so this refuses to try anywhere else rather than
 * making a request that will land on the app's own HTML and fail to parse. Guarding on
 * `import.meta.env.DEV` is also what lets a production build drop this whole module: the
 * condition is statically false, so nothing after it survives.
 */

const ROUTE = '/__component-source'

export interface SourceFile {
  /** Absolute path, as the server resolved it, which may differ from the one asked for. */
  file: string
  text: string
  /**
   * When the file was last written, which a later save sends back to prove it is editing the
   * version it was handed. That is what turns a concurrent external edit into a refusal
   * rather than a silent overwrite.
   */
  mtimeMs: number
}

export class SourceUnavailableError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'SourceUnavailableError'
  }
}

/**
 * The file moved under the edit.
 *
 * Its own type rather than a message, because the panel answers it differently from every
 * other failure: what was typed is still good, it is the base it was typed against that is
 * gone, so the offer is to look again rather than to try again.
 */
export class SourceConflictError extends Error {
  constructor() {
    super('This file changed on disk since it was opened here.')
    this.name = 'SourceConflictError'
  }
}

function isSourceFile(value: unknown): value is SourceFile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['file'] === 'string' &&
    typeof candidate['text'] === 'string' &&
    typeof candidate['mtimeMs'] === 'number'
  )
}

/** The contents of one library file, or a thrown error naming what went wrong. */
export async function readSource(file: string): Promise<SourceFile> {
  if (!import.meta.env.DEV) {
    throw new SourceUnavailableError('Source is only readable while the dev server is running.')
  }

  const response = await fetch(`${ROUTE}?file=${encodeURIComponent(file)}`)
  if (response.status === 403) {
    throw new SourceUnavailableError('That file is outside the component library.')
  }
  if (!response.ok) {
    throw new SourceUnavailableError(`The dev server could not read it (${response.status}).`)
  }

  const body: unknown = await response.json()
  // The response is this app's own dev server, but it is still parsed rather than cast: a
  // proxy or an offline service worker answering instead would otherwise reach the panel as
  // an object with no text and blank the editor.
  if (!isSourceFile(body)) {
    throw new SourceUnavailableError('The dev server answered with something unreadable.')
  }
  return body
}

/** What a write answers with: the same file, and the stamp a further save must carry. */
export interface SourceStamp {
  file: string
  mtimeMs: number
}

function isSourceStamp(value: unknown): value is SourceStamp {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate['file'] === 'string' && typeof candidate['mtimeMs'] === 'number'
}

/**
 * Writes one library file, and answers with the stamp of what is now on disk.
 *
 * `mtimeMs` is the stamp the read handed over, sent back as a precondition: the server writes
 * only if the file is still the one that was read. That is what makes a save from here safe
 * beside an ordinary editor, since the alternative is that whichever of the two saves last
 * silently wins.
 */
export async function writeSource(
  file: string,
  text: string,
  mtimeMs: number,
): Promise<SourceStamp> {
  if (!import.meta.env.DEV) {
    throw new SourceUnavailableError('Source is only writable while the dev server is running.')
  }

  const response = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, text, mtimeMs }),
  })
  if (response.status === 409) throw new SourceConflictError()
  if (response.status === 403) {
    throw new SourceUnavailableError('That file is outside the component library.')
  }
  if (response.status === 413) {
    throw new SourceUnavailableError('That is too large to be a component.')
  }
  if (!response.ok) {
    throw new SourceUnavailableError(`The dev server could not write it (${response.status}).`)
  }

  const body: unknown = await response.json()
  if (!isSourceStamp(body)) {
    throw new SourceUnavailableError('The dev server answered with something unreadable.')
  }
  return body
}
