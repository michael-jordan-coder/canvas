/**
 * Which page is allowed to open the socket.
 *
 * The loopback bind keeps the LAN out and does nothing about the machine itself, and a
 * WebSocket is not bound by the same origin policy: any page in any tab the person happens
 * to visit can open ws://localhost:5174, and with no check it becomes the editor, sends a
 * chat and runs turns on this machine's Claude Code login, reading back everything the
 * model says. The handshake does carry an Origin header naming the page that asked, and the
 * browser is the one thing that cannot be talked out of setting it honestly, so that header
 * is the whole of what this decides on.
 *
 * It buys nothing against a native process on this machine, which writes its own headers
 * and can claim any origin it likes. That is a different threat and wants a different
 * answer (a token, or not listening at all). An origin check is not the defence against it,
 * and reading it as one would be worse than reading it as nothing.
 *
 * `token.ts` is that token, and it is the partial half of that different answer: the handshake
 * carries a per-run secret in both directions, which raises the bar against a process that
 * grabs the port without also reading the token file, but not against a same-user process that
 * reads it. The two checks layer rather than replace: a connection has to clear this origin
 * check and present the token, and the editor in turn refuses a server that cannot echo it.
 *
 * Kept in its own module because importing `index.ts` binds the port, so nothing there is
 * testable.
 */

/**
 * The editor served from this machine, both spellings of the host in each case.
 *
 * Two ports rather than one, because `vite preview` is the same editor built the way it
 * ships and is used as often as the dev server here. Both are pinned with `strictPort`, so
 * these four are exact rather than a guess at where Vite happened to land.
 */
export const EDITOR_DEV_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

/**
 * `AGENT_ALLOWED_ORIGINS` as a list: comma separated, trimmed, empty entries dropped.
 *
 * It exists because the editor is a static build and can be served from a deployed host
 * while the sidecar still runs here, and that origin cannot be known when this is written.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** Everything a connection may claim to be: the dev origins, plus whatever the env adds. */
export function allowedOrigins(value: string | undefined): string[] {
  return [...EDITOR_DEV_ORIGINS, ...parseAllowedOrigins(value)]
}

export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  const claimed = origin?.trim()
  // A missing or empty Origin is refused rather than waved through as "probably a tool".
  // The only client that belongs here is a browser, and a browser always sends one.
  if (claimed === undefined || claimed.length === 0) return false
  // Exact equality, never a prefix test: `startsWith` would admit
  // http://localhost:5173.evil.com, which is a site someone else owns.
  return allowed.includes(claimed)
}
