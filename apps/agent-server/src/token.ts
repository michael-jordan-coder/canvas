import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOKEN_FILE_NAME, TOKEN_QUERY_KEY } from './tokenFile.ts'

/**
 * The shared secret the editor and the sidecar prove to each other, and the mirror image of
 * the check `origin.ts` makes.
 *
 * `origin.ts` hardens this server against a page: any tab can reach loopback, and the Origin
 * header is the one thing a browser cannot be talked out of setting honestly. The exposure it
 * leaves open runs the other way. The editor connects to whatever answers ws://localhost:5174
 * and, unchecked, runs every command that peer sends against the live document, code nodes
 * included. So a local process that squats on the port while the real sidecar is down becomes
 * the sidecar. The origin check does nothing here, because the untrusted party is now the
 * server, and a native process writes its own headers.
 *
 * The answer is a token neither side can guess. On startup the sidecar mints a random one and
 * writes it where the editor's delivery path can read it; the client presents it on the URL so
 * this server can refuse a client that does not hold it, and the server echoes it in `hello`
 * so the editor can refuse a server that does not hold it. A peer without the token is turned
 * away at the same point, and for the same reason, an unlisted origin is.
 *
 * Be honest about the fence this actually is. On a single-user machine any process running as
 * that user can read any file that user can read, and the file this token rides in is one of
 * them: a delivery path the editor can read is a delivery path a malicious local process can
 * read too. So this does not close the native-process threat `origin.ts` names, the one it
 * says wants "a token, or not listening at all". It is the token, and it is the partial half.
 * What it does raise the bar against is real: an opportunistic process that grabs the port
 * without also reading the token file cannot answer the handshake, and a deployed editor,
 * whose browser cannot read a local file at all, refuses a local sidecar rather than trusting
 * whatever holds the port. What it is not is a defence against a same-user attacker who reads
 * the file, and reading it as one would be worse than reading it as nothing.
 *
 * Kept out of `index.ts` for the reason `origin.ts` is: importing `index.ts` binds the port,
 * so the logic that decides who is admitted is only testable on its own.
 */

/** 32 bytes of randomness as hex: 64 characters the peer has no way to guess. */
export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Whether the token a peer presented is the one this run minted.
 *
 * A constant-time compare, so a peer cannot learn the token a byte at a time from how long a
 * near miss takes to be refused. `timingSafeEqual` throws on a length mismatch, so an unequal
 * length is answered first, which leaks nothing the token's fixed width did not already give
 * away. A missing or empty presentation is refused outright, the way `origin.ts` refuses a
 * missing Origin: the only client that belongs here has the token.
 */
export function tokensMatch(presented: string | undefined, expected: string): boolean {
  const claimed = presented?.trim()
  if (claimed === undefined || claimed.length === 0) return false
  const a = Buffer.from(claimed, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The token off a handshake URL, or undefined when the URL carries none. */
export function tokenFromUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return undefined
  const value = new URLSearchParams(url.slice(queryStart + 1)).get(TOKEN_QUERY_KEY)
  return value ?? undefined
}

/** Where the token file lives: the OS temp dir, under the shared name. */
export function tokenFilePath(): string {
  return join(tmpdir(), TOKEN_FILE_NAME)
}

/**
 * Writes the token to its file, owner read/write only, and answers the path so the caller can
 * name it in a log without naming the token.
 *
 * The `0o600` is a statement of intent more than a wall: on a single-user machine the owner is
 * the very account a local attacker already runs as. It keeps the token off group and world,
 * which is the part that is worth keeping, and `chmodSync` follows the write because the mode
 * on `writeFileSync` only applies when the file is created and this file outlives one run.
 */
export function writeTokenFile(token: string): string {
  const path = tokenFilePath()
  writeFileSync(path, token, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

/** The token from its file, or undefined when it is absent or unreadable. */
export function readTokenFile(): string | undefined {
  try {
    const value = readFileSync(tokenFilePath(), 'utf8').trim()
    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}
