import { AGENT_PORT } from '@canvas/agent-server/protocol'
import type { ClientMessage, ServerMessage } from '@canvas/agent-server/protocol'
import { scene } from '../state/scene'
import { useAgent } from './agentStore'
import { humanizeCommand, toolSummary } from './toolSummary'
import { executeCommand } from './executor'

/**
 * The editor's end of the bridge: one WebSocket to the agent server, reconnecting quietly
 * for as long as the tab lives, since the server may start after the editor or restart
 * under `--watch` mid-session.
 *
 * Two responsibilities meet here and are deliberately kept together, because they share the
 * turn's lifecycle: relaying chat between the panel and the server, and executing the
 * server's commands against the document. A turn is bracketed by `turn_start`/`turn_end`,
 * and the bracket maps onto a history group, so however many edits the agent makes, undo
 * treats the whole turn as one step, exactly the shape a nudge burst has. A socket that
 * dies mid-turn force-closes the group for the same reason window blur closes the nudge
 * one: nothing else ever would.
 */

const RECONNECT_DELAY_MS = 2000

let socket: WebSocket | null = null
let turnOpen = false
/** Set while a connection is alive, so the panel's Retry can skip the backoff wait. */
let connectNow: (() => void) | null = null

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
  switch (message.type) {
    case 'hello':
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
    case 'turn_end':
      closeTurn()
      agent.setStatus('idle')
      // A stop is a state the person put the turn in, so it reads as one. The server tells
      // us which it was, because the SDK reports an interrupt as an unsuccessful result and
      // the text would otherwise arrive here as "The agent stopped: <subtype>".
      if (message.stopped) agent.append('notice', 'Stopped.')
      else if (message.error) agent.append('error', message.error)
      return
  }
}

export function createAgentConnection(): () => void {
  let disposed = false
  let timer = 0

  const connect = (): void => {
    if (disposed) return
    window.clearTimeout(timer)
    const agent = useAgent.getState()
    agent.setStatus('connecting')
    agent.setNextAttemptAt(null)

    const ws = new WebSocket(`ws://localhost:${AGENT_PORT}`)
    socket = ws

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
      state.setStatus('offline')
      if (disposed) return
      timer = window.setTimeout(connect, RECONNECT_DELAY_MS)
      // The panel counts down from this rather than showing a spinner that means nothing:
      // an offline state that says when it will try again is a state, not a dead end.
      state.setNextAttemptAt(Date.now() + RECONNECT_DELAY_MS)
    }
    // The close handler fires after an error too, so this only silences the console.
    ws.onerror = () => {}
  }

  connectNow = connect
  connect()

  return () => {
    disposed = true
    connectNow = null
    window.clearTimeout(timer)
    closeTurn()
    socket?.close()
    socket = null
  }
}

/** What the panel calls. Module level so the panel needs no handle threaded through props. */
export const agentClient = {
  /**
   * Sends, and answers whether it went. False leaves the transcript untouched, so the panel
   * can keep the draft in the composer: a message nobody received must not look sent.
   */
  send(text: string): boolean {
    const agent = useAgent.getState()
    if (agent.status !== 'idle') return false
    if (!send({ type: 'chat', text })) {
      agent.append('notice', 'Not sent: the agent server is not connected.')
      return false
    }
    agent.append('user', text)
    // Optimistic: the server's turn_start confirms it, but the input should lock now.
    agent.setStatus('busy')
    return true
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
    if (agent.status === 'busy' || agent.status === 'stopping') return
    agent.clear()
    send({ type: 'reset' })
  },
  /** Retry now, instead of waiting out the backoff. */
  reconnect(): void {
    connectNow?.()
  },
}
