/**
 * The two names the token handshake shares across the process boundary.
 *
 * `protocol.ts` is the one contract both ends of the socket import; this is the smaller one
 * for the handshake that happens before the socket is trusted. The sidecar writes its token
 * into a file named `TOKEN_FILE_NAME` and reads the client's copy back off the URL under
 * `TOKEN_QUERY_KEY`; the editor's dev server reads the same file, and the editor presents the
 * token under the same key. Naming them in one place is what stops the writer and the reader
 * drifting to two different files or two different query keys and failing silently.
 *
 * Deliberately free of any Node import. The editor's type check has no `@types/node`, so
 * anything it pulls in has to stay resolvable without one, and both `vite.config.ts` and the
 * browser reach for these names.
 */

/** The file under the OS temp dir that the sidecar drops its per-run token into. */
export const TOKEN_FILE_NAME = 'figma-canvas-agent.token'

/** The query parameter the editor presents the token under on the socket URL. */
export const TOKEN_QUERY_KEY = 'token'
