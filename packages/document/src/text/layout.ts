import type { Rect, Size, Vec2 } from '../math.js'
import type { TextNode } from '../node.js'
import { glyphFor, type FontMetrics } from './metrics.js'

/**
 * Turning a string into positioned glyphs, with no DOM and no GPU.
 *
 * Everything here is pure and takes its font as a parameter, which is what lets the editor
 * and the renderer both call it. They have to: the editor writes the measured bounds onto the
 * node and draws the caret from them, the renderer packs one instance per glyph, and if those
 * two ever disagreed the caret would sit beside the text rather than in it.
 *
 * Two conventions run through the whole file:
 *
 * - **Local units.** Everything is in the text node's own space, where the node spans
 *   0..size, y downward from the top left. Nothing here knows about the camera.
 * - **UTF-16 offsets.** Every index is a `characters` offset in code units, the same thing
 *   `textarea.selectionStart` reports, so a caret can be handed between the two without
 *   conversion. Iteration is by code point, so an astral character is one glyph occupying
 *   two indices and the caret cannot land in the middle of it.
 */

export interface PlacedGlyph {
  /**
   * The code point actually drawn, which is the fallback when the atlas has no glyph for
   * what was typed. The renderer looks its image up by this, so it never has to re-resolve.
   */
  readonly code: number
  /** Offset of this glyph's first code unit in `characters`. */
  readonly index: number
  /** How many code units it occupies. 2 for an astral character, 1 otherwise. */
  readonly length: number
  /** Pen position at the glyph's origin, from the left edge of the text box. */
  readonly x: number
  readonly advance: number
}

export interface TextLine {
  /** UTF-16 offsets into `characters`. `end` is the newline's position, or the string's end. */
  readonly start: number
  readonly end: number
  readonly width: number
  /** From the top of the text box down to this line's baseline. */
  readonly baseline: number
  readonly glyphs: readonly PlacedGlyph[]
}

export interface TextLayout {
  readonly lines: readonly TextLine[]
  readonly width: number
  readonly height: number
  /** Baseline to baseline, in local units. */
  readonly lineHeight: number
  /** Top of a line box down to its baseline, in local units. Positive. */
  readonly ascent: number
}

/**
 * Lays `characters` out.
 *
 * With no `wrapWidth` the only breaks are the newlines that were typed, which is the auto
 * width box: the line is as long as the words make it. With one, a paragraph is also broken
 * greedily at spaces to fit, which is the fixed width box.
 *
 * An empty string still produces one line, so an empty text node has a caret to put
 * somewhere and a height to show it at. Its width is zero, which is also what makes it
 * unclickable until something is typed into it.
 */
export function layoutText(
  characters: string,
  fontSize: number,
  metrics: FontMetrics,
  wrapWidth: number | null = null,
): TextLayout {
  const lineHeight = metrics.lineHeight * fontSize
  const ascent = -metrics.ascender * fontSize

  const lines: TextLine[] = []
  let width = 0
  let paragraphStart = 0

  // Hand rolled rather than `split('\n')`, because every glyph carries its offset into the
  // original string and a split loses the arithmetic that recovers them.
  for (let cursor = 0; cursor <= characters.length; cursor += 1) {
    const atEnd = cursor === characters.length
    if (!atEnd && characters[cursor] !== '\n') continue

    for (const line of layoutParagraph(characters, paragraphStart, cursor, fontSize, metrics, wrapWidth)) {
      lines.push({ ...line, baseline: ascent + lines.length * lineHeight })
      width = Math.max(width, line.width)
    }
    paragraphStart = cursor + 1
  }

  return { lines, width, height: lines.length * lineHeight, lineHeight, ascent }
}

/** One glyph, before it has been assigned to a line or given an x. */
interface Item {
  code: number
  index: number
  length: number
  advance: number
  breakable: boolean
}

function itemsIn(
  characters: string,
  start: number,
  end: number,
  fontSize: number,
  metrics: FontMetrics,
): Item[] {
  const items: Item[] = []
  let index = start

  while (index < end) {
    const point = characters.codePointAt(index)
    if (point === undefined) break
    const length = point > 0xffff ? 2 : 1

    const glyph = glyphFor(metrics, point)
    if (glyph) {
      // The code recorded is the one that resolved, so an uncovered character packs and
      // measures as the fallback rather than being looked up a second time downstream.
      const code = metrics.glyphs.has(point) ? point : metrics.fallback
      // A plain space or a tab is where a line may break. A non-breaking space deliberately
      // is not, which is the entire reason it exists.
      const breakable = point === 0x20 || point === 0x09
      items.push({ code, index, length, advance: glyph.advance * fontSize, breakable })
    }

    index += length
  }

  return items
}

/**
 * A paragraph, as one line when it is not wrapping and as however many it needs when it is.
 *
 * Greedy, which is what every editor does: take words until the next one does not fit, then
 * start a line. Trailing spaces are allowed to hang past the edge rather than pushing a line
 * over, because a line that broke early on the space you just typed would look broken.
 *
 * A single word longer than the box breaks mid-word. Nothing else can be done with it, and
 * letting it overflow silently would put text outside the bounds that are hit tested.
 */
function layoutParagraph(
  characters: string,
  start: number,
  end: number,
  fontSize: number,
  metrics: FontMetrics,
  wrapWidth: number | null,
): Omit<TextLine, 'baseline'>[] {
  const items = itemsIn(characters, start, end, fontSize, metrics)
  if (wrapWidth === null || wrapWidth <= 0 || items.length === 0) {
    return [placeLine(items, start, end)]
  }

  const lines: Omit<TextLine, 'baseline'>[] = []
  let lineStart = 0
  let width = 0
  /** Where the last word ended, so a break can put the whole word on the next line. */
  let lastWordEnd = -1
  let inWord = false

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (!item) continue

    if (item.breakable) {
      if (inWord) lastWordEnd = i
      inWord = false
      width += item.advance
      continue
    }

    // Only a visible glyph can push a line over. Measured against the width so far, which
    // includes the spaces before it, since those are what put it where it is.
    if (width + item.advance > wrapWidth && i > lineStart) {
      const breakAt = lastWordEnd > lineStart && inWord ? lastWordEnd : i
      lines.push(placeLine(items.slice(lineStart, breakAt), offsetAt(items, lineStart, start), offsetAt(items, breakAt, end)))
      lineStart = breakAt
      width = 0
      lastWordEnd = -1
      // Recompute this item against the fresh line rather than skipping it.
      for (let j = lineStart; j < i; j += 1) width += items[j]?.advance ?? 0
    }

    inWord = true
    width += item.advance
  }

  lines.push(placeLine(items.slice(lineStart), offsetAt(items, lineStart, start), end))
  return lines
}

/** The character offset an item sits at, or `fallback` when the index is past the end. */
function offsetAt(items: Item[], at: number, fallback: number): number {
  return items[at]?.index ?? fallback
}

/** Assigns each glyph its x, and reports the width up to the last one that draws ink. */
function placeLine(items: Item[], start: number, end: number): Omit<TextLine, 'baseline'> {
  const glyphs: PlacedGlyph[] = []
  let x = 0
  // Trailing spaces hang past the end rather than counting, so a line of "a " is as wide as
  // "a". Otherwise every space typed at the end of a line would widen the box.
  let inked = 0

  for (const item of items) {
    glyphs.push({ code: item.code, index: item.index, length: item.length, x, advance: item.advance })
    x += item.advance
    if (!item.breakable) inked = x
  }

  return { start, end, width: inked, glyphs }
}

/** The bounds an auto width node's `size` should be set to. */
export function measureText(characters: string, fontSize: number, metrics: FontMetrics): Size {
  const layout = layoutText(characters, fontSize, metrics)
  return { width: layout.width, height: layout.height }
}

/**
 * The width a node wraps to, or null when it sizes itself to its words.
 *
 * Asked through here rather than read at each call site, because the renderer packing the
 * glyphs, the overlay drawing the caret and the input placing it all have to lay the same
 * node out the same way. A caret positioned against an unwrapped layout would sit a line
 * away from the text it belongs to.
 */
export function wrapWidthOf(node: TextNode): number | null {
  return node.autoWidth ? null : node.size.width
}

/** The layout of a node as it is actually configured. The one everything should call. */
export function layoutTextNode(node: TextNode, metrics: FontMetrics): TextLayout {
  return layoutText(node.characters, node.fontSize, metrics, wrapWidthOf(node))
}

/**
 * The bounds a node should cache, given a layout already computed for it.
 *
 * An auto width box takes both from its words. A fixed width one keeps the width it was
 * dragged to, which is the width its lines wrapped against, and only grows downward.
 *
 * Split from `measureTextNode` so a caller holding a layout does not lay the node out a
 * second time to ask its size. `TextLayoutCache` is the caller that does.
 */
export function textBounds(node: TextNode, layout: TextLayout): Size {
  return {
    width: node.autoWidth ? layout.width : node.size.width,
    height: layout.height,
  }
}

/** The bounds a node should cache. Lays it out to get them. */
export function measureTextNode(node: TextNode, metrics: FontMetrics): Size {
  return textBounds(node, layoutTextNode(node, metrics))
}

/** The line an offset falls on. Offsets at a line's end belong to that line, not the next. */
export function lineAt(layout: TextLayout, index: number): number {
  for (let i = 0; i < layout.lines.length; i += 1) {
    const line = layout.lines[i]
    if (line && index <= line.end) return i
  }
  return Math.max(0, layout.lines.length - 1)
}

/** Distance from the left edge of the text box to a caret sitting at `index`. */
export function caretX(layout: TextLayout, index: number): number {
  const line = layout.lines[lineAt(layout, index)]
  if (!line) return 0
  for (const glyph of line.glyphs) {
    if (index <= glyph.index) return glyph.x
  }
  return line.width
}

/**
 * Where to draw the caret, as a zero width rect spanning the line box.
 *
 * Zero width on purpose: a caret is one screen pixel at every zoom, so its thickness belongs
 * to the overlay that draws it in pixel space, not to the layout that positions it in the
 * document's units.
 */
export function caretRect(layout: TextLayout, index: number): Rect {
  const row = lineAt(layout, index)
  return {
    x: caretX(layout, index),
    y: row * layout.lineHeight,
    width: 0,
    height: layout.lineHeight,
  }
}

/**
 * The offset nearest a point in the text node's own space.
 *
 * Nearest, not containing: clicking past the end of a line puts the caret at its end rather
 * than nowhere, and clicking below the last line goes to the end of the text. A click lands
 * on whichever side of a glyph it is closer to, so the caret goes where the gap was aimed.
 */
export function caretAtPoint(layout: TextLayout, point: Vec2): number {
  if (layout.lines.length === 0) return 0

  const row = Math.min(
    layout.lines.length - 1,
    Math.max(0, Math.floor(point.y / layout.lineHeight)),
  )
  const line = layout.lines[row]
  if (!line) return 0

  for (const glyph of line.glyphs) {
    if (point.x < glyph.x + glyph.advance / 2) return glyph.index
  }
  return line.end
}

/**
 * One rect per line touched by the range, for the selection highlight.
 *
 * A line fully inside the range is highlighted to its text width rather than to the width of
 * the whole box, so a ragged paragraph reads as ragged. Empty lines inside the range produce
 * a zero width rect, which the overlay skips.
 */
export function selectionRects(layout: TextLayout, start: number, end: number): readonly Rect[] {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  if (from === to) return []

  const rects: Rect[] = []
  for (const [row, line] of layout.lines.entries()) {
    if (to <= line.start || from > line.end) continue
    const left = caretX(layout, Math.max(from, line.start))
    const right = caretX(layout, Math.min(to, line.end))
    if (right <= left) continue
    rects.push({
      x: left,
      y: row * layout.lineHeight,
      width: right - left,
      height: layout.lineHeight,
    })
  }
  return rects
}
