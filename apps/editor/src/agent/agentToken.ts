import { readStored } from '../state/localStorage'

/**
 * How the editor gets the sidecar's token, and how it compares one.
 *
 * The token is minted in the sidecar and never travels with the app, so the editor has to
 * fetch it before it can either present it on the socket or check the one the server echoes
 * back. Without it the editor cannot tell the real sidecar from a process squatting on the
 * port, so "no token" resolves to "stay offline and refuse", never to "connect anyway".
 *
 * Two sources, in order. In dev and preview the editor is served by Vite, which reads the
 * token file and serves it back from `TOKEN_ENDPOINT` on its own origin (see `vite.config.ts`),
 * so a same-origin fetch reaches it under the page's `connect-src 'self'`. A deployed editor is
 * static, served from some host while the sidecar runs on the person's machine, and a browser
 * there cannot read a local file: the token has to be pasted into local storage by hand, or the
 * editor has no way to verify the sidecar and refuses. That manual path is the deployed case's
 * whole bridge, and its absence is a safe refusal rather than a silent trust.
 */

/** Same origin, so the page's `connect-src 'self'` admits it. */
const TOKEN_ENDPOINT = '/__agent_token'

/** Where a deployed editor looks when Vite is not the one serving it. */
const STORED_TOKEN_KEY = 'figma-canvas:agent-token'

/**
 * The shape the sidecar mints: 64 hex characters. Checked rather than trusted, because a
 * static host with an SPA fallback answers an unknown path with `index.html`, and HTML parsed
 * as a token has to read as "no token" instead of as a token that will never match.
 */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export async function loadAgentToken(): Promise<string | null> {
  const served = await fetchServedToken()
  if (served !== null) return served
  const stored = readStored(STORED_TOKEN_KEY)?.trim()
  return stored !== undefined && TOKEN_PATTERN.test(stored) ? stored : null
}

async function fetchServedToken(): Promise<string | null> {
  try {
    const response = await fetch(TOKEN_ENDPOINT, { cache: 'no-store' })
    if (!response.ok) return null
    const text = (await response.text()).trim()
    return TOKEN_PATTERN.test(text) ? text : null
  } catch {
    // No such endpoint (a deployed host), or the sidecar has not written its token yet.
    return null
  }
}

/**
 * Whether the token a server echoed is the one this editor holds, in constant time so a rogue
 * server cannot learn it a byte at a time from how quickly a near miss is refused. A null local
 * token, or a length mismatch, is a refusal outright.
 */
export function tokensEqual(presented: string | undefined, expected: string | null): boolean {
  if (expected === null) return false
  const claimed = presented?.trim()
  if (claimed === undefined || claimed.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < claimed.length; i += 1) {
    diff |= claimed.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}
