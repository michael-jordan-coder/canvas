import { AGENT_PORT } from '@canvas/agent-server/protocol'
import type {
  Attachment,
  ClientMessage,
  QuestionAnswer,
  ServerMessage,
} from '@canvas/agent-server/protocol'
import { TOKEN_QUERY_KEY } from '@canvas/agent-server/tokenFile'
import { scene } from '../state/scene'
import { isWorking, useAgent } from './agentStore'
import { turnEndItem } from './turnEnd'
import { clearSavedTranscript } from './chatStorage'
import { reconnectDelay } from './reconnect'
import { humanizeCommand, toolSummary } from './toolSummary'
import { executeCommand } from './executor'
import { loadAgentToken, tokensEqual } from './agentToken'

/**
 * The editor's end of the bridge: one WebSocket to the agent server, reconnecting quietly
 * for as long as the tab lives, since the server may start after the editor or restart
 * under `--watch` mid-session.
 *
 * One close is different: `evicted` means a newer tab took the socket, and the timer must
 * not answer it. The server keeps one editor and closes the previous, so two tabs both
 * reconnecting on timers steal the connection from each other every two seconds, forever,
 * with turn messages landing in whichever tab holds it at that instant. The displaced tab
 * goes passive instead, and only the person asking for the assistant back in that tab takes
 * the socket back on purpose.
 *
 * Two responsibilities meet here and are deliberately kept together, because they share the
 * turn's lifecycle: relaying chat between the panel and the server, and executing the
 * server's commands against the document. A turn is bracketed by `turn_start`/`turn_end`,
 * and the bracket maps onto a history group, so however many edits the agent makes, undo
 * treats the whole turn as one step, exactly the shape a nudge burst has. A socket that
 * dies mid-turn force-closes the group for the same reason window blur closes the nudge
 * one: nothing else ever would.
 */

let socket: WebSocket | null = null
let turnOpen = false
/**
 * Whether the peer on the other end has proved it is the sidecar, by echoing the token this
 * editor holds in its `hello`. It starts false on every connection and gates command
 * execution: nothing the server sends runs against the document until this is true. The real
 * sidecar sends `hello` first, so it flips before any command arrives; a process squatting on
 * the port that cannot echo the token never flips it, and its commands are dropped.
 */
let verified = false
/** The token this connection was opened with, compared against the one `hello` echoes. */
let currentToken: string | null = null
/**
 * Whether this page has already said it could not verify the server. Once is the right number,
 * the way the stale-transcript notice is: a rogue peer left on the port is reconnected to on
 * the backoff, and a notice on every cycle would bury everything else.
 */
let verifyFailNoticed = false
/**
 * Whether another tab took the editor. It suppresses the reconnect that would otherwise
 * take it straight back, so the two tabs hand over once instead of trading it forever.
 * Cleared by `connect`, which is the only thing that asks for it again.
 */
let displaced = false
/** Set while a connection is alive, so the panel's Retry can skip the backoff wait. */
let connectNow: (() => void) | null = null
/**
 * A New chat that could not be delivered. The server holds the conversation, so clearing
 * the panel while the socket is down would leave the next turn quietly resuming a
 * conversation the person believes they ended. It is sent the moment one is up.
 */
let pendingReset = false
/**
 * Whether this page has already said that its restored transcript is only a record. Once is
 * the right number: the server can restart several times in a session, and repeating it
 * every reconnect would bury the conversation it is about.
 */
let staleNoticed = false

/**
 * Whether the socket took the message. The caller has to know: the panel used to append the
 * person's message and go busy before finding out, which left it waiting on a reply that
 * was never asked for and no way back short of a reload.
 */
function send(message: ClientMessage): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(message))
  return true
}

function closeTurn(): void {
  if (!turnOpen) return
  turnOpen = false
  scene.endHistoryGroup()
}

async function runCommand(id: number, name: string, args: unknown): Promise<void> {
  try {
    const value = await executeCommand(name, args)
    send({ type: 'result', id, ok: true, value })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    send({ type: 'result', id, ok: false, error: message })
    // The model is told, and so is the person. It recovers from most of these on its own,
    // which is why this folds in with the steps rather than interrupting the conversation,
    // but a turn that quietly failed half its edits must not look like a turn that worked.
    useAgent.getState().append('tool-error', `${humanizeCommand(name)} failed: ${message}`)
  }
}

function onMessage(message: ServerMessage): void {
  const agent = useAgent.getState()
  if (message.type === 'hello') {
    // The server proves it holds the token before anything it says is acted on. A peer that
    // cannot echo the token this editor was handed is not the sidecar, whatever it claims: the
    // socket is dropped, and `onclose` takes it offline and schedules the retry.
    if (!tokensEqual(message.token, currentToken)) {
      if (!verifyFailNoticed) {
        verifyFailNoticed = true
        agent.append('notice', 'Could not verify the assistant server, so it is not being used.')
      }
      socket?.close()
      return
    }
    verified = true
  } else if (!verified) {
    // Nothing runs before the handshake completes. The real sidecar sends `hello` first, so
    // this only ever drops a message from a peer that skipped proving itself.
    return
  }
  switch (message.type) {
    case 'hello':
      if (pendingReset) {
        pendingReset = false
        send({ type: 'reset' })
      }
      // A transcript restored from a previous page, against a server that no longer holds
      // the conversation. It is still worth reading, but it is not what the model knows.
      if (!message.session && !staleNoticed && agent.items.length > 0) {
        staleNoticed = true
        agent.append('notice', 'Earlier conversation. The assistant is starting fresh from here.')
      }
      agent.setStatus(message.busy ? 'busy' : 'idle')
      return
    case 'turn_start':
      agent.setStatus('busy')
      if (!turnOpen) {
        turnOpen = true
        scene.beginHistoryGroup()
      }
      return
    case 'assistant':
      agent.append('assistant', message.text)
      return
    case 'thinking':
      agent.append('thinking', message.text)
      return
    case 'tool':
      // Summarised here rather than in the panel: the item's text is what a restored
      // transcript holds, and the args are not saved with it.
      agent.append('tool', toolSummary(message.name, message.args))
      return
    case 'command':
      void runCommand(message.id, message.name, message.args)
      return
    case 'ask':
      // An interactive card in the transcript, not a folded step: the turn is now waiting on
      // the person, and the answer travels back over `answer`, not as a command result.
      agent.ask(message.id, message.question)
      return
    case 'turn_end': {
      closeTurn()
      // A question still open when the turn ends can no longer be answered to anything, so its
      // card settles into an unanswered record rather than staying live.
      agent.clearPendingAsk()
      agent.setStatus('idle')
      // The server sends why, which is the part only it can know; what that reads as is
      // decided here, with the rest of the assistant's copy.
      const ending = turnEndItem(message.reason, message.detail)
      if (ending) agent.append(ending.kind, ending.text)
      return
    }
    case 'evicted':
      // Not an error and not a disconnection: the assistant is somewhere the person can
      // still reach, so the panel says where rather than counting down to nothing.
      displaced = true
      closeTurn()
      agent.clearPendingAsk()
      agent.setStatus('displaced')
      agent.setNextAttemptAt(null)
      return
    case 'rejected':
      // Back into the composer, where it can be sent again once the turn ends.
      agent.setDraft(message.text)
      agent.setStatus('idle')
      agent.append('notice', 'Not sent: the assistant was still working.')
      return
  }
}

export function createAgentConnection(): () => void {
  let disposed = false
  let timer = 0
  /** How many attempts have failed in a row, which is what the backoff grows with. */
  let attempts = 0

  /**
   * Schedules the next attempt on the backoff. Shared by the socket closing and the case where
   * no token is available to open one with, so both roads back are the same countdown.
   */
  const scheduleReconnect = (): void => {
    if (disposed) return
    const delay = reconnectDelay(attempts)
    attempts += 1
    timer = window.setTimeout(() => void connect(), delay)
    // The panel counts down from this rather than showing a spinner that means nothing:
    // an offline state that says when it will try again is a state, not a dead end.
    useAgent.getState().setNextAttemptAt(Date.now() + delay)
  }

  const connect = async (): Promise<void> => {
    if (disposed) return
    window.clearTimeout(timer)
    displaced = false
    verified = false
    const agent = useAgent.getState()
    agent.setStatus('connecting')
    agent.setNextAttemptAt(null)

    // Fetched fresh each attempt, not cached: the sidecar mints a new token every restart, so a
    // token held from a previous connection would fail the very check it is meant to pass.
    const token = await loadAgentToken()
    if (disposed || socket !== null) return
    if (token === null) {
      // No token, so the sidecar cannot be told from a squatter, so the editor does not connect.
      // In dev this clears itself the moment the sidecar has written its token; on a deployed
      // host with none it reads as offline, which is the honest state.
      agent.setStatus('offline')
      scheduleReconnect()
      return
    }
    currentToken = token

    const ws = new WebSocket(`ws://localhost:${AGENT_PORT}/?${TOKEN_QUERY_KEY}=${encodeURIComponent(token)}`)
    socket = ws

    ws.onopen = () => {
      attempts = 0
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      let message: ServerMessage
      try {
        message = JSON.parse(event.data) as ServerMessage
      } catch {
        return
      }
      onMessage(message)
    }

    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      closeTurn()
      const state = useAgent.getState()
      // A pending question cannot be answered to a server that is gone, so its card stops
      // waiting. The server rejects its side on the same disconnect.
      state.clearPendingAsk()
      // Displaced keeps its own status: this close is the handover completing, not the
      // server going away, and there is nothing to count down to.
      if (displaced) return
      state.setStatus('offline')
      scheduleReconnect()
    }
    // The close handler fires after an error too, so this only silences the console.
    ws.onerror = () => {}
  }

  connectNow = () => void connect()
  void connect()

  return () => {
    disposed = true
    connectNow = null
    window.clearTimeout(timer)
    closeTurn()
    socket?.close()
    socket = null
  }
}

/** Back to a data URL for display; the stripped base64 is what goes over the wire. */
export function toDataUrl(attachment: Attachment): string {
  return `data:${attachment.mimeType};base64,${attachment.base64}`
}

/** What the panel calls. Module level so the panel needs no handle threaded through props. */
export const agentClient = {
  /**
   * Sends, and answers whether it went. False leaves the transcript untouched, so the panel
   * can keep the draft in the composer: a message nobody received must not look sent.
   */
  send(text: string, attachments?: Attachment[]): boolean {
    const agent = useAgent.getState()
    if (agent.status !== 'idle') return false
    if (!send({ type: 'chat', text, attachments })) {
      agent.append('notice', 'Not sent: the agent server is not connected.')
      return false
    }
    agent.append('user', text, attachments?.map(toDataUrl))
    // Optimistic: the server's turn_start confirms it, but the input should lock now.
    agent.setStatus('busy')
    return true
  },
  /**
   * Answers the pending question. Writes the choice onto the card at once, so it settles into a
   * record the moment the person picks, and sends it back to the waiting turn. Only reachable
   * while a question is pending, which is only ever while the socket is up.
   */
  answer(askId: number, answer: QuestionAnswer): void {
    useAgent.getState().answerQuestion(askId, answer)
    send({ type: 'answer', id: askId, answer })
  },
  stop(): void {
    const agent = useAgent.getState()
    if (agent.status !== 'busy') return
    // Stopping is its own state: the interrupt reaches the model between tool calls, so the
    // turn can take a moment to end and the button must not look like it did nothing.
    if (send({ type: 'stop' })) agent.setStatus('stopping')
  },
  reset(): void {
    const agent = useAgent.getState()
    if (isWorking(agent.status)) return
    agent.clear()
    // Cleared on disk in the same call, or a reload a moment later would restore it from a
    // debounce that had not fired yet.
    clearSavedTranscript()
    if (!send({ type: 'reset' })) pendingReset = true
  },
  /** Retry now, instead of waiting out the backoff. */
  reconnect(): void {
    connectNow?.()
  },
}
