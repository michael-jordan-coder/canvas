import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { TOKEN_FILE_NAME } from '@canvas/agent-server/tokenFile'

// The editor's type check has no `@types/node` on purpose: nothing under `src` may touch a Node
// builtin, which is how the document package's no-DOM rule has a sibling here. The dev server is
// the one place that has to, since handing the sidecar's token to the browser means reading a
// file, so the three builtins that costs are declared here rather than by pulling Node's whole
// surface into the editor and losing the guard everywhere else.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}
declare module 'node:os' {
  export function tmpdir(): string
}

/** Same origin, so the page's `connect-src 'self'` admits the editor's fetch of it. */
const TOKEN_ENDPOINT = '/__agent_token'

/**
 * Hands the sidecar's token to the browser in dev and preview.
 *
 * The token is minted in the sidecar and written to a file; the editor cannot read a file, but
 * the server that serves the editor can, so this reads it back on the same origin. It is read
 * fresh on every request rather than once at startup, because `pnpm dev` starts the editor and
 * the sidecar together and in no fixed order: the file may not exist yet on the first request,
 * and the sidecar mints a new token on every `--watch` restart. An absent or unreadable file
 * answers empty, which the editor reads as "no token" and stays offline over, never as a token.
 *
 * A deployed static host runs none of this, so its browser gets no token and refuses the local
 * sidecar rather than trusting it. That is the intended floor, not a gap.
 */
function agentToken(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url !== TOKEN_ENDPOINT) {
      next()
      return
    }
    let token = ''
    try {
      // POSIX join, matching what the sidecar writes with node:path on this platform. The
      // token module owns the real path; this dev-only reader avoids a node:path shim that
      // collides with an ambient `path` type in the editor's Node-free type check.
      token = readFileSync(`${tmpdir()}/${TOKEN_FILE_NAME}`, 'utf8').trim()
    } catch {
      // Sidecar not up yet, or no token written. Empty is the editor's cue to stay offline.
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(token)
  }
  return {
    name: 'agent-token',
    // Added in the hook body, so it runs before Vite's own middlewares and the SPA fallback
    // cannot answer this path with index.html.
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve)
    },
  }
}

export default defineConfig({
  plugins: [react(), agentToken()],
  server: {
    // 5173 on purpose. The other repos in this folder fight over 3000.
    port: 5173,
    strictPort: true,
  },
  // Pinned for the same reason the dev port is, and for one more: the agent server admits
  // the editor by origin, so a preview that silently landed on the next free port would be
  // refused by it and look like the assistant was broken rather than like a moved port.
  preview: {
    port: 4173,
    strictPort: true,
  },
})
