import type { Size } from '../math.js'
import type { NodeId, TextNode } from '../node.js'
import { layoutTextNode, textBounds, wrapWidthOf, type TextLayout } from './layout.js'
import type { FontMetrics } from './metrics.js'

/** A layout, kept with everything that decided it, so a stale one is recognised as stale. */
interface Entry {
  /** Compared by identity. A different font produces different advances and different bounds. */
  metrics: FontMetrics
  characters: string
  fontSize: number
  /** Part of the key: a fixed width box re-wraps when it is dragged wider. */
  wrapWidth: number | null
  layout: TextLayout
}

/**
 * One layout per text node, shared by everything that needs one.
 *
 * Laying a paragraph out is the most expensive thing this package does, and four separate
 * places want the answer for the same node in the same frame: the packer emits an instance
 * per glyph, the overlay places the caret and the selection highlight, the input layer maps
 * a click to an offset, and the editor measures the bounds it writes back onto the node. A
 * keystroke used to pay for three of those and an idle caret blink for one, twice a second,
 * over text that had not changed since it was typed.
 *
 * Sharing them is also a correctness property rather than only a saving. The caret, the
 * glyphs and the clickable box are three views of one layout, and two of them computed
 * separately could disagree by a rounding.
 *
 * ### Eviction
 *
 * Two maps, swapped by `sweep`. An entry survives one sweep untouched and falls out on the
 * next, so a deleted node's layout is not held forever and nothing has to watch the document
 * to know it went. Reading promotes, so anything still in use stays.
 */
export class TextLayoutCache {
  #current = new Map<NodeId, Entry>()
  #previous = new Map<NodeId, Entry>()

  /**
   * The layout of a node as it is configured, computing it only if nothing cached matches.
   *
   * The key is everything `layoutTextNode` reads, so a hit is exact rather than probable.
   */
  layoutFor(node: TextNode, metrics: FontMetrics): TextLayout {
    const wrapWidth = wrapWidthOf(node)
    const hit = this.#current.get(node.id) ?? this.#previous.get(node.id)
    if (
      hit &&
      hit.metrics === metrics &&
      hit.characters === node.characters &&
      hit.fontSize === node.fontSize &&
      hit.wrapWidth === wrapWidth
    ) {
      this.#current.set(node.id, hit)
      return hit.layout
    }

    const layout = layoutTextNode(node, metrics)
    this.#current.set(node.id, {
      metrics,
      characters: node.characters,
      fontSize: node.fontSize,
      wrapWidth,
      layout,
    })
    return layout
  }

  /**
   * The bounds a node should cache as its `size`.
   *
   * Worth going through here rather than calling `measureTextNode`, because the layout this
   * measures is the one the renderer is about to pack: measuring the text a keystroke
   * produced warms the entry the next frame reads.
   */
  measure(node: TextNode, metrics: FontMetrics): Size {
    return textBounds(node, this.layoutFor(node, metrics))
  }

  /**
   * Ages every entry by one generation.
   *
   * Called from the instance buffer's rebuild, because that is the only pass that visits the
   * whole document and so the only one that can tell a node still in the scene from one that
   * has been deleted. A rebuild happens on every document change, which is also the only
   * thing that can invalidate a layout.
   */
  sweep(): void {
    this.#previous = this.#current
    this.#current = new Map()
  }
}
