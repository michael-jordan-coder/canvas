import { AGENT_PORT } from '@figma-canvas/agent-server/protocol'
import type { ClientMessage, ServerMessage } from '@figma-canvas/agent-server/protocol'
import { scene } from '../state/scene'
import { useAgent } from './agentStore'
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

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
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
      agent.append('tool', message.name)
      return
    case 'command':
      void runCommand(message.id, message.name, message.args)
      return
    case 'turn_end':
      closeTurn()
      agent.setStatus('idle')
      if (message.error) agent.append('error', message.error)
      return
  }
}

export function createAgentConnection(): () => void {
  let disposed = false
  let timer = 0

  const connect = (): void => {
    if (disposed) return
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
      useAgent.getState().setStatus('offline')
      if (!disposed) timer = window.setTimeout(connect, RECONNECT_DELAY_MS)
    }
    // The close handler fires after an error too, so this only silences the console.
    ws.onerror = () => {}
  }

  connect()

  return () => {
    disposed = true
    window.clearTimeout(timer)
    closeTurn()
    socket?.close()
    socket = null
  }
}

/** What the panel calls. Module level so the panel needs no handle threaded through props. */
export const agentClient = {
  send(text: string): void {
    const agent = useAgent.getState()
    if (agent.status !== 'idle') return
    agent.append('user', text)
    // Optimistic: the server's turn_start confirms it, but the input should lock now.
    agent.setStatus('busy')
    send({ type: 'chat', text })
  },
  stop(): void {
    send({ type: 'stop' })
  },
  reset(): void {
    const agent = useAgent.getState()
    if (agent.status === 'busy') return
    agent.clear()
    send({ type: 'reset' })
  },
}
