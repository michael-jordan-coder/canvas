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
