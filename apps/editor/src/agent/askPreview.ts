import { useAgent } from './agentStore'

/**
 * `?ask` in the URL: a transcript of question cards to look at, in place of the saved one.
 * `?ask=multi` makes the live one a multiple selection.
 *
 * The same idea as `?stress`, and for the same reason. A question card is the hardest surface
 * in this app to get in front of your eyes, because reaching it for real means a live agent
 * turn that happens to decide to ask, and the two settled states around it, an answered record
 * and one the turn ended without answering, cannot be reached deliberately at all.
 *
 * Two things are switched off with it, both on the rule stress mode already follows: the
 * transcript is not autosaved, since a throwaway conversation must not land on top of a real
 * one, and the socket is not opened, since connecting would set a status over the one the
 * preview needs and start a turn's worth of machinery for a conversation that is not happening.
 *
 * Only one card is ever live, because the store holds one `pendingAsk` and that is the truth
 * rather than a limitation of the preview: the assistant asks one question at a time.
 */
export type AskPreview = 'single' | 'multi' | null

export function askPreviewFromLocation(): AskPreview {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('ask')) return null
  return params.get('ask') === 'multi' ? 'multi' : 'single'
}

const QUESTION = 'Which layout should I use for the sign-in screen?'

const OPTIONS = [{ label: 'Centered card with price' }, { label: 'fluid panel and text shadows' }]

/**
 * The three states, in the order a transcript would hold them: a question that was answered, one
 * the turn ended before answering, and the one being asked now. `clearPendingAsk` after the
 * second is what settles it, and asking the live one last is what leaves it pending.
 */
export function seedAskPreview(kind: Exclude<AskPreview, null>): void {
  const store = useAgent.getState()
  store.setOpen(true)
  store.append('user', 'Design a sign in screen')

  store.ask(1, { header: 'Layout', question: QUESTION, options: OPTIONS, multiSelect: false })
  // One mark, since a single selection is one answer. The typed kind is reachable from the
  // live card below by writing in its free text row and submitting.
  store.answerQuestion(1, { selected: ['Centered card with price'] })

  store.ask(2, { header: 'Layout', question: QUESTION, options: OPTIONS, multiSelect: false })
  store.clearPendingAsk()

  if (kind === 'multi') {
    store.ask(3, {
      header: 'Tone',
      question: 'Which of these should the copy be? Pick as many as apply.',
      options: [{ label: 'Formal' }, { label: 'Casual' }, { label: 'Playful' }],
      multiSelect: true,
    })
  } else {
    store.ask(3, { header: 'Layout', question: QUESTION, options: OPTIONS, multiSelect: false })
  }
}
