import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeId } from '@canvas/document'
import { useAgent, type AgentStatus } from '../agent/agentStore'
import { startPanelFollow } from './panelFollow'
import { useUI } from './uiStore'

const node = (name: string): NodeId => name as NodeId

let stop: () => void

/** The assistant tab showing, with the agent in the given state. */
function showAssistant(status: AgentStatus): void {
  useAgent.setState({ open: true, selectionUnseen: false, status })
}

beforeEach(() => {
  useUI.setState({ selection: [] })
  useAgent.setState({ open: false, selectionUnseen: false, status: 'idle' })
  stop = startPanelFollow()
})

afterEach(() => {
  stop()
})

describe('startPanelFollow', () => {
  it('brings the properties forward when something is selected', () => {
    showAssistant('idle')
    useUI.getState().setSelection([node('a')])
    expect(useAgent.getState().open).toBe(false)
    expect(useAgent.getState().selectionUnseen).toBe(false)
  })

  // The whole point of the exception: the assistant moves the selection itself, and a turn
  // is exactly when the conversation is being read.
  it('holds the switch back during a turn and marks the tab instead', () => {
    showAssistant('busy')
    useUI.getState().setSelection([node('a')])
    expect(useAgent.getState().open).toBe(true)
    expect(useAgent.getState().selectionUnseen).toBe(true)
  })

  it('holds it back while a stop is still landing', () => {
    showAssistant('stopping')
    useUI.getState().setSelection([node('a')])
    expect(useAgent.getState().open).toBe(true)
  })

  it('clears the mark when the properties are looked at', () => {
    showAssistant('busy')
    useUI.getState().setSelection([node('a')])
    useAgent.getState().setOpen(false)
    expect(useAgent.getState().selectionUnseen).toBe(false)
  })

  // Clearing the selection is not a request to look at anything, and the properties have
  // nothing to show for it.
  it('ignores a selection being cleared', () => {
    useUI.getState().setSelection([node('a')])
    showAssistant('idle')
    useUI.getState().clearSelection()
    expect(useAgent.getState().open).toBe(true)
  })

  it('leaves no mark while the properties are already showing', () => {
    useAgent.setState({ open: false, selectionUnseen: false, status: 'busy' })
    useUI.getState().setSelection([node('a')])
    expect(useAgent.getState().selectionUnseen).toBe(false)
  })

  // A change that is not a change: some callers write the same array back.
  it('does nothing when the selection is written unchanged', () => {
    const selection = [node('a')]
    useUI.getState().setSelection(selection)
    showAssistant('idle')
    useUI.getState().setSelection(selection)
    expect(useAgent.getState().open).toBe(true)
  })
})
