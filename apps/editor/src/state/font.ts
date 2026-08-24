import { TextLayoutCache, type FontMetrics, type Size, type TextNode } from '@canvas/document'
import { loadFontMetrics } from '@canvas/renderer'
import { relayout, relayoutAll, setTextMeasurer } from './autoLayout'
import { scene } from './scene'

let loaded: FontMetrics | null = null

/**
 * The one laid out copy of every text node, shared with the renderer.
 *
 * Owned here rather than inside the renderer because it outlives one: the app measures text
 * whether or not a GPU device came up, and a renderer recreated by a strict mode remount or a
 * lost device would otherwise throw away every layout in the document. Handed to
 * `createWebGPURenderer` through `RendererInit`.
 *
 * Created eagerly, with no font, because the metrics arrive over the network while this
 * module loads synchronously. Nothing lays anything out before they land.
 */
export const textLayouts = new TextLayoutCache()

/*
 * How auto layout measures a text child it is about to hand a width: through the shared
 * cache under the node's own id, so the layout the measurement builds is the one the
 * renderer packs and the caret reads a frame later.
 */
setTextMeasurer({
  measure: (node, wrapWidth) => {
    const metrics = loaded
    if (!metrics) return null
    return textLayouts.measure(
      { ...node, autoWidth: false, size: { ...node.size, width: wrapWidth } },
      metrics,
    )
  },
})

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
    const size = textLayouts.measure(node, metrics)
    if (size.width !== node.size.width || size.height !== node.size.height) stale.push({ node, size })
  }

  scene.transact(() => {
    for (const { node, size } of stale) scene.update<TextNode>(node.id, { size })
    // Run even when nothing was stale: a text child laid out with a fill width before the
    // font arrived kept a guessed height, and only the layout knows which nodes those are.
    relayoutAll(scene)
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
 *
 * Measuring the change rather than the node is also what makes the next frame free: the
 * layout this produces is keyed by the text the edit is about to write, so the packer and the
 * caret both read it back instead of laying the same string out again.
 */
function measure(node: TextNode, changes: Partial<TextNode> = {}): Size | null {
  const metrics = loaded
  return metrics ? textLayouts.measure({ ...node, ...changes }, metrics) : null
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
  scene.transact(() => {
    scene.update<TextNode>(node.id, size ? { ...changes, size } : changes)
    // Typing into a hug frame grows it on the keystroke, in the keystroke's own undo step.
    relayout(scene, [node.id])
  })
}
