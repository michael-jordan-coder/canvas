import { query } from '@anthropic-ai/claude-agent-sdk'
import { WebSocketServer, WebSocket } from 'ws'
import { AGENT_PORT, type ClientMessage, type CommandName, type ServerMessage } from './protocol.ts'
import { createCanvasMcpServer } from './tools.ts'
import { SYSTEM_PROMPT } from './prompt.ts'
import { describeResult } from './turnEnd.ts'

/**
 * The agent sidecar: Claude with hands on the canvas.
 *
 * The Agent SDK only runs in Node, and it authenticates through the Claude Code login on
 * this machine, so there is no key anywhere in this process. The document, meanwhile, lives
 * in the browser tab. This server is the bridge between the two: chat comes in over the
 * editor's WebSocket, the query runs here, and every tool call goes back over the same
 * socket as a command the editor executes against the live document. The edits are
 * therefore real edits, visible as they happen and folded into the editor's own undo.
 */

/** The screenshot waits on two animation frames in the browser, so it gets headroom. */
const COMMAND_TIMEOUT_MS = 30_000

// Loopback only. The editor connects from this machine, and an open bind would let anyone
// on the LAN drive the agent: their prompts, this account's subscription, this document.
const wss = new WebSocketServer({ port: AGENT_PORT, host: '127.0.0.1' })

/**
 * One editor at a time. A second tab taking over is deliberate: the alternative is two
 * documents answering the same tool call, and the newest connection is the one the person
 * is actually looking at.
 */
let editor: WebSocket | null = null

let busy = false
/** The running query, kept so a stop request can interrupt it mid-turn. */
let activeQuery: { interrupt: () => Promise<unknown> } | null = null
/**
 * Whether the turn now ending was interrupted on request. The SDK reports an interrupt as a
 * result with an unsuccessful subtype, indistinguishable from the turn cap or a real
 * failure, so the one thing that knows a stop happened is the code that asked for it.
 */
let interrupted = false
/** Multi-turn memory: the SDK session resumed on the next message. Reset starts fresh. */
let sessionId: string | undefined

let nextCommandId = 1
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()

function send(message: ServerMessage): void {
  if (editor?.readyState === WebSocket.OPEN) editor.send(JSON.stringify(message))
}

/** Rejects everything in flight, for when the editor goes away mid-turn. */
function failPending(reason: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
    pending.delete(id)
  }
}

function forward(name: CommandName, args: unknown): Promise<unknown> {
  if (editor?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('The editor is not connected.'))
  }
  const id = nextCommandId
  nextCommandId += 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`The editor did not answer ${name} within ${COMMAND_TIMEOUT_MS / 1000}s.`))
    }, COMMAND_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    send({ type: 'tool', name, args })
    send({ type: 'command', id, name, args })
  })
}

const canvas = createCanvasMcpServer(forward)

async function runChat(text: string): Promise<void> {
  busy = true
  interrupted = false
  send({ type: 'turn_start' })
  let error: string | undefined

  try {
    const q = query({
      prompt: text,
      options: {
        ...(sessionId ? { resume: sessionId } : {}),
        systemPrompt: SYSTEM_PROMPT,
        // No built-ins: an agent embedded in an app gets exactly the tools the app defines,
        // not Read/Write/Bash on this machine.
        tools: [],
        mcpServers: { canvas },
        allowedTools: ['mcp__canvas__*'],
        permissionMode: 'dontAsk',
        maxTurns: 50,
      },
    })
    activeQuery = q

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) send({ type: 'assistant', text: block.text })
          if (block.type === 'thinking' && block.thinking) {
            send({ type: 'thinking', text: block.thinking })
          }
        }
      }
      if (msg.type === 'result') {
        sessionId = 'session_id' in msg ? msg.session_id : sessionId
        if (msg.subtype !== 'success') error = describeResult(msg.subtype)
      }
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'The agent failed.'
  } finally {
    activeQuery = null
    busy = false
    if (interrupted) send({ type: 'turn_end', stopped: true })
    else send({ type: 'turn_end', ...(error ? { error } : {}) })
  }
}

function onMessage(raw: string): void {
  let message: ClientMessage
  try {
    message = JSON.parse(raw) as ClientMessage
  } catch {
    return
  }

  switch (message.type) {
    case 'chat': {
      const text = message.text.trim()
      if (!text) return
      // Refused out loud. Dropping it silently left the person watching a message that had
      // been typed, sent and forgotten by everything downstream.
      if (busy) {
        send({ type: 'rejected', reason: 'busy', text: message.text })
        return
      }
      void runChat(text)
      return
    }
    case 'stop': {
      if (activeQuery) interrupted = true
      void activeQuery?.interrupt().catch(() => {
        // Interrupting a query that just finished on its own is not a failure.
      })
      return
    }
    case 'reset': {
      if (!busy) sessionId = undefined
      return
    }
    case 'result': {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.ok) entry.resolve(message.value)
      else entry.reject(new Error(message.error ?? 'The editor rejected the command.'))
      return
    }
  }
}

wss.on('connection', (socket) => {
  if (editor && editor !== socket) editor.close()
  editor = socket
  send({ type: 'hello', busy, session: sessionId !== undefined })

  socket.on('message', (data) => {
    onMessage(typeof data === 'string' ? data : data.toString())
  })

  socket.on('close', () => {
    if (editor !== socket) return
    editor = null
    failPending('The editor disconnected.')
    // The person closed the tab mid-turn; without them there is nothing to design on.
    void activeQuery?.interrupt().catch(() => {})
  })
})

console.log(`agent server listening on ws://localhost:${AGENT_PORT}`)
