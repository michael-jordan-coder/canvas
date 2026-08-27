import type { IncomingMessage } from 'node:http'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { WebSocketServer, WebSocket } from 'ws'
import {
  AGENT_PORT,
  formatAnswer,
  type AgentQuestion,
  type ClientMessage,
  type CommandName,
  type ServerMessage,
  type TurnEndReason,
} from './protocol.ts'
import { createCanvasMcpServer } from './tools/index.ts'
import { SYSTEM_PROMPT } from './prompt.ts'
import { resultReason } from './turnEnd.ts'
import { allowedOrigins, isOriginAllowed } from './origin.ts'
import { generateToken, tokenFromUrl, tokensMatch, writeTokenFile } from './token.ts'

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

/** Generous, because a command runs behind whatever the browser is already doing. */
const COMMAND_TIMEOUT_MS = 30_000

const ALLOWED_ORIGINS = allowedOrigins(process.env.AGENT_ALLOWED_ORIGINS)

// Minted once per run and written where the editor's delivery path can read it. The value is
// never logged, only the path is: the file is the one thing here worth not writing down twice.
const SESSION_TOKEN = generateToken()
const TOKEN_FILE = writeTokenFile(SESSION_TOKEN)

// Loopback only. The editor connects from this machine, and an open bind would let anyone
// on the LAN drive the agent: their prompts, this account's subscription, this document.
// The bind is half of it. A page in any tab can reach loopback too, so `origin.ts` decides
// which page may, and a native process that spoofs the origin is turned away by the token it
// cannot present. Both refusals happen in the handshake: nothing below this line, and no
// agent code at all, ever sees a socket that failed either check.
const wss = new WebSocketServer({
  port: AGENT_PORT,
  host: '127.0.0.1',
  // Annotated because `verifyClient` is a union of a sync and an async signature, and a
  // union infers nothing for the parameter.
  verifyClient: ({ req }: { req: IncomingMessage }) => {
    const origin = req.headers.origin
    if (!isOriginAllowed(origin, ALLOWED_ORIGINS)) {
      // Named, because the one failure this produces in normal use is an editor served from
      // an origin nobody has listed, and a silent handshake failure says nothing about why.
      console.warn(`agent server refused a connection from origin ${origin ?? '(none)'}`)
      return false
    }
    if (!tokensMatch(tokenFromUrl(req.url), SESSION_TOKEN)) {
      // The origin, never the token: the value is the one thing here worth not logging, and a
      // client that reached the right origin without the secret is the case worth naming.
      console.warn(`agent server refused a connection from origin ${origin} without a valid token`)
      return false
    }
    return true
  },
})

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

/**
 * A question waits on a person, not on the editor, so it gets minutes rather than the command
 * window's seconds. Long enough that a real deliberation never trips it, bounded so a tool that
 * was forgotten does not pin a turn open forever.
 */
const QUESTION_TIMEOUT_MS = 10 * 60_000
let nextQuestionId = 1
const pendingQuestions = new Map<
  number,
  { resolve: (text: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
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

/**
 * The same, for questions. Kept separate because their tool call is awaiting a human: a stop
 * or a lost editor has to unblock it, or the query hangs on a tool that will never answer.
 */
function failPendingQuestions(reason: string): void {
  for (const [id, entry] of pendingQuestions) {
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
    pendingQuestions.delete(id)
  }
}

/**
 * Puts a question to the editor and resolves with the person's answer as one line. The `ask`
 * side of the tool: no document command runs, the editor renders a card and answers with
 * `answer`, and the whole thing is held on the long question timeout.
 */
function askQuestion(question: AgentQuestion): Promise<string> {
  if (editor?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('The editor is not connected.'))
  }
  const id = nextQuestionId
  nextQuestionId += 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingQuestions.delete(id)
      reject(new Error('The person did not answer in time.'))
    }, QUESTION_TIMEOUT_MS)
    pendingQuestions.set(id, { resolve, reject, timer })
    send({ type: 'ask', id, question })
  })
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

const canvas = createCanvasMcpServer(forward, askQuestion)

async function runChat(text: string): Promise<void> {
  busy = true
  interrupted = false
  send({ type: 'turn_start' })
  // How the turn ended, kept as a reason the protocol names rather than as a sentence.
  let ending: { reason: TurnEndReason; detail?: string } = { reason: 'ok' }

  try {
    const q = query({
      prompt: text,
      options: {
        ...(sessionId ? { resume: sessionId } : {}),
        systemPrompt: SYSTEM_PROMPT,
        // Adaptive so the model decides when and how much to reason, summarised so what streams
        // back is a readable account rather than the raw scratchpad. The turn loop below already
        // forwards `thinking` blocks; without this they never arrive, and the panel's thinking
        // row stays dead code. It is the one line that makes the assistant show its work.
        thinking: { type: 'adaptive', display: 'summarized' },
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
        if (msg.subtype !== 'success') ending = resultReason(msg.subtype)
      }
    }
  } catch (cause) {
    ending = {
      reason: 'error',
      ...(cause instanceof Error && cause.message ? { detail: cause.message } : {}),
    }
  } finally {
    activeQuery = null
    busy = false
    // A stop wins over whatever the SDK called the turn it cut short: the person asked.
    if (interrupted) send({ type: 'turn_end', reason: 'stopped' })
    else send({ type: 'turn_end', ...ending })
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
      // Unblock any question the turn is waiting on, or the query hangs interrupting a tool
      // that is itself waiting on a person who is no longer going to answer.
      failPendingQuestions('The person stopped the turn.')
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
    case 'answer': {
      const entry = pendingQuestions.get(message.id)
      if (!entry) return
      pendingQuestions.delete(message.id)
      clearTimeout(entry.timer)
      // Formatted through the shared helper, so the tool result reads the same as the record
      // the editor leaves on the answered card.
      entry.resolve(formatAnswer(message.answer))
      return
    }
  }
}

wss.on('connection', (socket) => {
  if (editor && editor !== socket) {
    // Told before it is closed, so it knows this was a handover rather than the server
    // going away. A tab that cannot tell the two apart reconnects on its backoff and
    // displaces this one straight back.
    const displaced = editor
    if (displaced.readyState === WebSocket.OPEN) {
      displaced.send(JSON.stringify({ type: 'evicted' } satisfies ServerMessage))
    }
    displaced.close()
  }
  editor = socket
  // The token rides back so the editor can prove this is the sidecar and not a squatter. A
  // client only reaches this line by presenting the token in `verifyClient`, so it already
  // holds what is echoed: nothing new is handed out here.
  send({ type: 'hello', busy, session: sessionId !== undefined, token: SESSION_TOKEN })

  socket.on('message', (data) => {
    onMessage(typeof data === 'string' ? data : data.toString())
  })

  socket.on('close', () => {
    if (editor !== socket) return
    editor = null
    failPending('The editor disconnected.')
    failPendingQuestions('The editor disconnected.')
    // The person closed the tab mid-turn; without them there is nothing to design on.
    void activeQuery?.interrupt().catch(() => {})
  })
})

console.log(`agent server listening on ws://localhost:${AGENT_PORT}`)
console.log(`agent token written to ${TOKEN_FILE}`)
