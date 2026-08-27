import { isWorking, useAgent } from '../agent/agentStore'
import { useUI } from './uiStore'

/**
 * The rule that decides which tab the right panel is on when something is selected.
 *
 * Selecting a node means "tell me about this", and the panel that tells you is the
 * properties one, so a new selection brings it forward. That is only a question at all
 * because the assistant shares the column now: a segmented control is mutual exclusion by
 * construction, so one of the two has to yield, and the selection is the more recent
 * statement of what the person wants to see.
 *
 * The exception is a turn in flight. The assistant changes the selection itself, through
 * `set_selection` and by pruning what it deletes, and a tab that flipped on either would
 * take the conversation off screen while it is being read, which is exactly when there is
 * most to read. So a selection arriving mid turn leaves a dot on the properties tab instead
 * and waits to be asked for. Nothing is lost by waiting: the transcript, the draft and the
 * turn itself all live outside this panel, so the tab it is on changes nothing but what is
 * visible.
 *
 * A subscription rather than a call inside `setSelection`, because every way a selection
 * can change would otherwise have to remember this: the pointer, the layers panel, the
 * keyboard, undo, and the agent's own commands.
 */
export function startPanelFollow(): () => void {
  return useUI.subscribe((state, previous) => {
    const selection = state.selection
    if (selection === previous.selection) return

    // Clearing the selection is not a request to look at anything, and the properties panel
    // has nothing to show for it. Only a selection worth reading pulls the tab.
    if (selection.length === 0) return

    const agent = useAgent.getState()
    if (!agent.open) return
    if (isWorking(agent.status)) agent.setSelectionUnseen(true)
    else agent.setOpen(false)
  })
}
