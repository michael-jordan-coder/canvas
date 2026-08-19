import { measureTextNode, type FontMetrics, type Size, type TextNode } from '@figma-canvas/document'
import { loadFontMetrics } from '@figma-canvas/renderer'
import { scene } from './scene'

let loaded: FontMetrics | null = null

/**
 * The font the editor measures with, or null until it arrives.
 *
 * Read rather than awaited, because the callers are input handlers and a keystroke cannot
 * wait on a promise. In practice it resolves during startup, long before anyone can select
 * the text tool, so the null is a formality that still has to be honoured.
 */
export function fontMetrics(): FontMetrics | null {
  return loaded
}

/**
 * A text node caches its measured bounds, and the font that produced them arrives after the
 * document does: a saved file loads synchronously from local storage, the atlas comes over
 * the network. So every text node is measured once when the font lands.
 *
 * This is also what keeps a file honest across a change of font. The bounds decide what you
 * can click and where the selection box sits, and nothing else recomputes them, so a
 * document saved by a build with different metrics would otherwise stay subtly wrong.
 */
void loadFontMetrics().then((metrics) => {
  loaded = metrics
  remeasureAll(metrics)
})

function remeasureAll(metrics: FontMetrics): void {
  const stale: { node: TextNode; size: Size }[] = []
  for (const node of scene.walk()) {
    if (node.type !== 'text') continue
    const size = measureTextNode(node, metrics)
    if (size.width !== node.size.width || size.height !== node.size.height) stale.push({ node, size })
  }
  if (stale.length === 0) return

  scene.transact(() => {
    for (const { node, size } of stale) scene.update<TextNode>(node.id, { size })
  })
  // Measuring is not an edit. Leaving it on the stack would make the first undo of a fresh
  // session shrink every text node to whatever it was before the font was known.
  scene.clearHistory()
}

/**
 * The bounds a node would have with `changes` applied, or null if the font has not arrived.
 *
 * Null rather than a zero size, which a caller would happily write to a node and leave it
 * invisible and unclickable.
 */
function measure(node: TextNode, changes: Partial<TextNode> = {}): Size | null {
  const metrics = loaded
  return metrics ? measureTextNode({ ...node, ...changes }, metrics) : null
}

/**
 * Changes a text node and rewrites its cached bounds in the same update.
 *
 * The one door for every edit to a text node, because `size` is a cache of the text and the
 * two have to move together: a step that restored one without the other would leave the node
 * clickable somewhere it is not drawn. It was a comment on `TextNode` and five separate
 * spellings at the call sites, three of which disagreed about what to do before the font had
 * loaded. Answering that once, here, is the whole point.
 *
 * Before the font arrives the change still lands and the stale bounds are left alone, since
 * `remeasureAll` above corrects every node the moment it does.
 */
export function updateText(node: TextNode, changes: Partial<TextNode>): void {
  const size = measure(node, changes)
  scene.update<TextNode>(node.id, size ? { ...changes, size } : changes)
}
