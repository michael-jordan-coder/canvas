import { clearMeasurements } from '../components/measure'
import { subscribeToLibrary } from '../components/registry'
import { setNodeMeasurer } from './autoLayout'
import { measureComponentInLayout, remeasureComponents } from './componentNodes'
import { measureTextNode } from './font'
import { scene } from './scene'

/**
 * Where the two halves of measurement are joined and handed to the layout engine.
 *
 * There is one measurer slot and two kinds of node that need one, so neither half can
 * register itself: whichever module was imported second would silently replace the first.
 * This module is the only one that knows about both, and it is imported for its effect the
 * same way `state/font.ts` is.
 */
setNodeMeasurer({
  measure: (node, width) => {
    if (node.type === 'text') return measureTextNode(node, width)
    if (node.type === 'component') return measureComponentInLayout(node, width)
    // Everything else has a size of its own and nothing to ask about.
    return null
  },
})

/*
 * Components can be measured the moment there is a DOM, which is now: unlike the font, there
 * is nothing to wait for. A saved file carries the sizes its components rendered at when it
 * was saved, and a change to a component's own CSS since then would leave every instance
 * clickable somewhere it is no longer drawn.
 *
 * Not an edit, so the history is dropped afterwards, exactly as it is after the font lands.
 */
remeasureComponents(scene)
scene.clearHistory()

/** A component's source changing resizes every instance of it. See `SETTLE_PASSES`. */
subscribeToLibrary(() => {
  for (const delay of SETTLE_PASSES) window.setTimeout(remeasureQuietly, delay)
})

/**
 * When to look again after a component's source changed.
 *
 * A hot update carries two things that are applied independently: the description of the
 * library, which this subscription hangs off, and the component's own module, whose re-render
 * React Fast Refresh debounces. So the first look can measure the component that is being
 * replaced, and there is no callback for "the refresh has landed" to wait on instead.
 *
 * Looking more than once is the answer rather than looking later, because a look is free when
 * nothing changed: every measurement is compared against what the node already holds, so a
 * pass that finds the same numbers produces no patch, no version bump, no redraw and no undo
 * step. The first pass catches the common case immediately and the last one catches a slow
 * machine.
 */
const SETTLE_PASSES = [0, 120, 400]

/**
 * Measures every component and writes back what moved, leaving no trace in the history.
 *
 * A component's source changing resizes every instance of it, and that is not an edit anyone
 * performed: it is the same remeasurement the font's arrival triggers, with a code change as
 * the cause instead of a network response. The group is opened and then aborted rather than
 * committed, which is the primitive a cancelled drag already uses: the writes land on the live
 * document and no step reaches the undo stack. Clearing history instead would throw away the
 * work of whoever happened to be editing when the file was saved.
 */
function remeasureQuietly(): void {
  // Every pass forgets first. The cache is keyed by component, props and width, none of which
  // change when the markup does, so a pass that ran before the refresh landed would otherwise
  // have cached the old size under the new component's key and every later pass would agree
  // with it.
  clearMeasurements()
  scene.beginHistoryGroup()
  try {
    remeasureComponents(scene)
  } finally {
    scene.abortHistoryGroup()
  }
}
