import { describe, expect, it } from 'vitest'

import {
  caretAtPoint,
  caretRect,
  caretX,
  layoutText,
  lineAt,
  measureText,
  selectionRects,
} from './layout.js'
import type { FontMetrics, GlyphMetrics } from './metrics.js'

/*
 * A made up font with round numbers, so every expectation below can be worked out by hand.
 *
 * Most letters advance half an em. 'i' advances a quarter, which is what catches code that
 * assumes a fixed pitch. At the 20px size these tests use: a normal letter is 10px wide, 'i'
 * is 5px, a line is 25px tall and its baseline sits 20px below the top of the line box.
 */
const SIZE = 20

function glyph(advance: number, drawn = true): GlyphMetrics {
  return {
    advance,
    quad: drawn
      ? { plane: { x: 0, y: -0.7, width: 0.5, height: 0.75 }, uv: { x: 0, y: 0, width: 0.1, height: 0.1 } }
      : null,
  }
}

const METRICS: FontMetrics = {
  lineHeight: 1.25,
  ascender: -1,
  descender: 0.25,
  pxRange: 4,
  fallback: 0x3f,
  glyphs: new Map<number, GlyphMetrics>([
    [0x20, glyph(0.25, false)],
    [0xa0, glyph(0.25, false)],
    [0x3f, glyph(0.5)],
    [0x61, glyph(0.5)],
    [0x62, glyph(0.5)],
    [0x63, glyph(0.5)],
    [0x64, glyph(0.5)],
    [0x69, glyph(0.25)],
    [0x1f600, glyph(0.5)],
  ]),
}

const lay = (characters: string) => layoutText(characters, SIZE, METRICS)

describe('layoutText', () => {
  it('advances the pen by each glyph, so a narrow letter takes less room', () => {
    expect(lay('abc').width).toBe(30)
    expect(lay('abi').width).toBe(25)
  })

  it('reports a height of one line box per line', () => {
    expect(lay('abc').height).toBe(25)
    expect(lay('ab\ncd').height).toBe(50)
  })

  it('takes its width from the longest line', () => {
    expect(lay('a\nabcd\nab').width).toBe(40)
  })

  it('puts the first baseline an ascender below the top', () => {
    expect(lay('abc').lines[0]?.baseline).toBe(20)
  })

  it('spaces later baselines by the line height', () => {
    const lines = lay('a\nb\nc').lines
    expect(lines.map((line) => line.baseline)).toEqual([20, 45, 70])
  })

  it('gives an empty string one line, so an empty node still has somewhere to put a caret', () => {
    const layout = lay('')
    expect(layout.lines).toHaveLength(1)
    expect(layout.width).toBe(0)
    expect(layout.height).toBe(25)
  })

  it('counts a trailing newline as opening a further line, the way a text field does', () => {
    const layout = lay('a\n')
    expect(layout.lines).toHaveLength(2)
    expect(layout.lines[1]?.glyphs).toHaveLength(0)
    expect(layout.height).toBe(50)
  })

  it('keeps consecutive blank lines rather than collapsing them', () => {
    expect(lay('a\n\n\nb').lines).toHaveLength(4)
  })

  it('records offsets into the original string, not into the line', () => {
    const second = lay('ab\ncd').lines[1]
    expect(second?.start).toBe(3)
    expect(second?.glyphs.map((g) => g.index)).toEqual([3, 4])
  })

  it('advances for whitespace but gives it no image to draw', () => {
    expect(lay('a b').width).toBe(25)
    expect(METRICS.glyphs.get(0x20)?.quad).toBeNull()
  })

  it('substitutes the fallback for a code point the atlas does not carry', () => {
    const glyphs = lay('中').lines[0]?.glyphs
    expect(glyphs).toHaveLength(1)
    expect(glyphs?.[0]?.code).toBe(0x3f)
  })

  it('treats an astral character as one glyph occupying two offsets', () => {
    const line = lay('a\u{1f600}b').lines[0]
    expect(line?.glyphs.map((g) => g.index)).toEqual([0, 1, 3])
    expect(line?.glyphs[1]?.length).toBe(2)
  })
})

describe('measureText', () => {
  it('is the bounds a text node should cache as its size', () => {
    expect(measureText('ab\ncd', SIZE, METRICS)).toEqual({ width: 20, height: 50 })
  })
})

describe('lineAt', () => {
  const layout = lay('ab\ncd')

  it('keeps an offset at a line end on that line rather than the next', () => {
    expect(lineAt(layout, 2)).toBe(0)
  })

  it('puts the offset just past the newline on the following line', () => {
    expect(lineAt(layout, 3)).toBe(1)
  })

  it('clamps past the end of the text', () => {
    expect(lineAt(layout, 99)).toBe(1)
  })
})

describe('caretX and caretRect', () => {
  it('sits at the left edge before the first character', () => {
    expect(caretX(lay('abc'), 0)).toBe(0)
  })

  it('sits after the glyphs it has passed', () => {
    expect(caretX(lay('abc'), 2)).toBe(20)
  })

  it('sits at the line width at the end of a line', () => {
    expect(caretX(lay('abc'), 3)).toBe(30)
  })

  it('measures from the left of the box on a later line, not from the text start', () => {
    expect(caretX(lay('abcd\nab'), 6)).toBe(10)
  })

  it('spans the line box, with no width of its own', () => {
    expect(caretRect(lay('ab\ncd'), 4)).toEqual({ x: 10, y: 25, width: 0, height: 25 })
  })
})

describe('caretAtPoint', () => {
  const layout = lay('abcd')

  it('lands before a glyph when the click is on its left half', () => {
    expect(caretAtPoint(layout, { x: 12, y: 10 })).toBe(1)
  })

  it('lands after a glyph when the click is on its right half', () => {
    expect(caretAtPoint(layout, { x: 18, y: 10 })).toBe(2)
  })

  it('goes to the end of the line when the click is past the text', () => {
    expect(caretAtPoint(layout, { x: 500, y: 10 })).toBe(4)
  })

  it('clamps to the first line above the text and the last line below it', () => {
    const two = lay('ab\ncd')
    expect(caretAtPoint(two, { x: 0, y: -50 })).toBe(0)
    expect(caretAtPoint(two, { x: 500, y: 500 })).toBe(5)
  })

  it('picks the line the click is vertically inside', () => {
    expect(caretAtPoint(lay('ab\ncd'), { x: 0, y: 30 })).toBe(3)
  })

  it('round trips against caretX', () => {
    const text = lay('abcd')
    for (let index = 0; index <= 4; index += 1) {
      expect(caretAtPoint(text, { x: caretX(text, index), y: 10 })).toBe(index)
    }
  })
})

describe('selectionRects', () => {
  it('is empty for a collapsed range, which is a caret rather than a selection', () => {
    expect(selectionRects(lay('abc'), 2, 2)).toEqual([])
  })

  it('covers just the selected glyphs on one line', () => {
    expect(selectionRects(lay('abcd'), 1, 3)).toEqual([{ x: 10, y: 0, width: 20, height: 25 }])
  })

  it('reads the same whichever end the drag started from', () => {
    const layout = lay('abcd')
    expect(selectionRects(layout, 3, 1)).toEqual(selectionRects(layout, 1, 3))
  })

  it('gives one rect per line, each ending at its own text width', () => {
    const rects = selectionRects(lay('abcd\nab'), 1, 6)
    expect(rects).toEqual([
      { x: 10, y: 0, width: 30, height: 25 },
      { x: 0, y: 25, width: 10, height: 25 },
    ])
  })

  it('skips a line the range only touches the boundary of', () => {
    // From the end of the first line to inside the second: nothing of the first is selected.
    expect(selectionRects(lay('ab\ncd'), 2, 4)).toEqual([{ x: 0, y: 25, width: 10, height: 25 }])
  })

  it('skips an empty line rather than emitting a zero width rect', () => {
    expect(selectionRects(lay('a\n\nb'), 0, 4)).toHaveLength(2)
  })
})

/*
 * Wrapping, at the same made up font. Every letter is 10px wide at this size and a space is
 * 5px, so "aa bb" is 25px and the arithmetic in each case is worth checking by hand.
 */
describe('layoutText, wrapping to a width', () => {
  const wrap = (characters: string, width: number) => layoutText(characters, SIZE, METRICS, width)
  const textOf = (layout: ReturnType<typeof wrap>) =>
    layout.lines.map((line) => line.glyphs.map((g) => String.fromCodePoint(g.code)).join(''))

  it('breaks at a space when the next word does not fit', () => {
    // "aa" is 20, the space takes it to 25, "bb" would reach 45.
    expect(textOf(wrap('aa bb', 30))).toEqual(['aa ', 'bb'])
  })

  it('keeps words that do fit on one line', () => {
    expect(textOf(wrap('aa bb', 50))).toEqual(['aa bb'])
  })

  it('does not count a trailing space against the width', () => {
    // "aaa " is 35 with the space and 30 without, so at 30 it still fits.
    expect(wrap('aaa ', 30).lines).toHaveLength(1)
    expect(wrap('aaa ', 30).width).toBe(30)
  })

  it('fills each line greedily rather than balancing them', () => {
    expect(textOf(wrap('a a a a', 35))).toEqual(['a a ', 'a a'])
  })

  it('breaks a single word that cannot fit at all, rather than overflowing', () => {
    // Nothing else can be done with it, and overflowing would draw text outside the bounds
    // that are hit tested.
    expect(textOf(wrap('aaaaa', 25))).toEqual(['aa', 'aa', 'a'])
  })

  it('keeps explicit newlines as breaks of their own', () => {
    expect(textOf(wrap('aa\nbb', 500))).toEqual(['aa', 'bb'])
  })

  it('wraps within a paragraph and still honours its newline', () => {
    expect(textOf(wrap('aa bb\ncc', 30))).toEqual(['aa ', 'bb', 'cc'])
  })

  it('does not break at a non-breaking space, which is the point of one', () => {
    /*
     * A normal space in this position is the break, so it stays at the end of the first line
     * and the whole of "bb" moves down. A non-breaking one is not a break opportunity at all,
     * so the run has nowhere to give and hard breaks after it instead. The two outcomes
     * differ in which line the space itself ends up on.
     */
    const breaking = wrap('aaaa bb', 45)
    expect(breaking.lines[0]?.glyphs.at(-1)?.code).toBe(0x20)
    expect(textOf(breaking)).toEqual(['aaaa ', 'bb'])

    const nonBreaking = wrap('aaaa bb', 45)
    expect(nonBreaking.lines[0]?.glyphs.at(-1)?.code).toBe(0xa0)
  })

  it('grows downward, one line box per line', () => {
    expect(wrap('aa bb', 30).height).toBe(50)
  })

  it('reports offsets into the original string across a wrap', () => {
    const second = wrap('aa bb', 30).lines[1]
    expect(second?.glyphs.map((g) => g.index)).toEqual([3, 4])
  })

  it('is unchanged from the auto width layout when the width is not a constraint', () => {
    expect(textOf(wrap('aa bb cc', 10_000))).toEqual(textOf(layoutText('aa bb cc', SIZE, METRICS)))
  })

  it('ignores a width of zero rather than breaking every character onto its own line', () => {
    expect(textOf(wrap('aa bb', 0))).toEqual(['aa bb'])
  })

  it('places a caret on the wrapped line it belongs to', () => {
    const layout = wrap('aa bb', 30)
    // Offset 4 is between the two b's, on the second line.
    expect(caretRect(layout, 4)).toEqual({ x: 10, y: 25, width: 0, height: 25 })
  })
})
