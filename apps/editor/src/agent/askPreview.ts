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
 * What it does not do is ask anything downstream to make an exception for it. The seed drives
 * the store the way a turn would, status included, so no component has to know the flag exists;
 * a preview a component has to be told about is a preview of something else.
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

/**
 * Deliberately uneven: one label that fits, one that wraps at the panel's floor, and one with
 * no description at all, since the protocol allows it even though the built-in tool always
 * sends one. The card is only worth looking at under the lengths it will actually receive.
 */
const OPTIONS = [
  {
    label: 'Centered card with price',
    description:
      'A single column on a plain ground, the price above the button. Reads well at any width and needs no artwork.',
  },
  {
    label: 'Fluid panel with text shadows and a full bleed background image',
    description:
      'The form floats over the image, which carries the mood. Wants a picture good enough to hold the whole screen.',
  },
  { label: 'Split screen' },
]

/**
 * The three states, in the order a transcript would hold them: a question that was answered, one
 * the turn ended before answering, and the one being asked now. `clearPendingAsk` after the
 * second is what settles it, and asking the live one last is what leaves it pending.
 */
export function seedAskPreview(kind: Exclude<AskPreview, null>): void {
  const store = useAgent.getState()
  store.setOpen(true)
  // Busy, because a live question is one a running turn is waiting on, and the store is where
  // that is said. Set here rather than excepted for downstream: the panel asks the same
  // question of a seeded turn as of a real one, and so does everything else that reads the
  // status, which is what makes the preview worth looking at.
  store.setStatus('busy')
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
      options: [
        { label: 'Formal', description: 'Full sentences, no contractions, nothing playful.' },
        { label: 'Casual', description: 'The way you would say it to someone at the next desk.' },
        { label: 'Playful', description: 'Jokes allowed, as long as they are not in the way.' },
      ],
      multiSelect: true,
    })
  } else {
    store.ask(3, { header: 'Layout', question: QUESTION, options: OPTIONS, multiSelect: false })
  }
}
