import { describe, expect, it } from 'vitest'
import {
  drawnPaints,
  drawnStrokes,
  fromHex,
  isPaintVisible,
  paintOpacity,
  parseHex,
  strokesOutset,
  type Paint,
  type Stroke,
  type StrokeAlign,
} from './paint.js'

describe('parseHex', () => {
  it('parses a 6 digit hex with a leading #', () => {
    const parsed = parseHex('#ff8800')
    expect(parsed?.color.r).toBeCloseTo(1)
    expect(parsed?.color.g).toBeCloseTo(0x88 / 255)
    expect(parsed?.color.b).toBeCloseTo(0)
  })

  it('parses a 6 digit hex without a leading #', () => {
    expect(parseHex('ff8800')).not.toBeNull()
  })

  it('parses a 3 digit hex, expanding each digit', () => {
    const parsed = parseHex('#f80')
    expect(parsed?.color.r).toBeCloseTo(1)
    expect(parsed?.color.g).toBeCloseTo(0x88 / 255)
    expect(parsed?.color.b).toBeCloseTo(0)
  })

  it('is case insensitive', () => {
    expect(parseHex('#FF8800')).not.toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(parseHex('  #ff8800  ')).not.toBeNull()
  })

  it('rejects the wrong number of digits', () => {
    expect(parseHex('#ff88')).toBeNull()
    expect(parseHex('#ff88000')).toBeNull()
  })

  it('rejects non hex characters', () => {
    expect(parseHex('#gggggg')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(parseHex('')).toBeNull()
  })

  it('carries the alpha argument through', () => {
    expect(parseHex('#ff8800', 0.5)?.color.a).toBe(0.5)
  })
})

describe('paint defaults', () => {
  it('reads an absent opacity as fully opaque and an absent visible as shown', () => {
    const paint = fromHex('#ff8800')
    expect(paintOpacity(paint)).toBe(1)
    expect(isPaintVisible(paint)).toBe(true)
  })

  it('reads the fields when they are there', () => {
    expect(paintOpacity({ ...fromHex('#ff8800'), opacity: 0.25 })).toBe(0.25)
    expect(isPaintVisible({ ...fromHex('#ff8800'), visible: false })).toBe(false)
  })
})

describe('drawnPaints', () => {
  const red = fromHex('#ff0000')
  const green = fromHex('#00ff00')
  const blue = fromHex('#0000ff')

  // The list is top to bottom and the buffer is back to front, so the two run opposite ways.
  it('reverses the list, so the first row is painted last and lands on top', () => {
    expect(drawnPaints([red, green, blue])).toEqual([blue, green, red])
  })

  it('drops a hidden paint and leaves the rest in their relative order', () => {
    const hidden: Paint = { ...green, visible: false }
    expect(drawnPaints([red, hidden, blue])).toEqual([blue, red])
  })

  it('keeps a fully transparent paint, since transparent is a colour and hidden is not', () => {
    expect(drawnPaints([{ ...red, opacity: 0 }])).toHaveLength(1)
  })

  it('returns nothing for an empty stack', () => {
    expect(drawnPaints([])).toEqual([])
  })
})

describe('drawnStrokes', () => {
  const stroke = (weight: number, paint: Paint = fromHex('#ff0000')): Stroke => ({
    paint,
    weight,
    align: 'center',
  })

  it('reverses the list the same way the fills do', () => {
    const first = stroke(1)
    const second = stroke(2)
    expect(drawnStrokes([first, second])).toEqual([second, first])
  })

  it('drops a weightless stroke, which has no band to draw', () => {
    expect(drawnStrokes([stroke(0), stroke(2)])).toEqual([stroke(2)])
  })

  it('drops a stroke whose paint is hidden', () => {
    expect(drawnStrokes([stroke(2, { ...fromHex('#ff0000'), visible: false })])).toEqual([])
  })
})

describe('strokesOutset', () => {
  const stroke = (weight: number, align: StrokeAlign): Stroke => ({
    paint: fromHex('#ff0000'),
    weight,
    align,
  })

  it('is zero with no strokes at all', () => {
    expect(strokesOutset([])).toBe(0)
  })

  // The widest reach rather than the first one's, because all of them are on screen at once
  // and the clickable area has to cover the outermost.
  it('takes the largest reach in the stack, whatever order it sits in', () => {
    expect(strokesOutset([stroke(2, 'outside'), stroke(20, 'outside')])).toBe(20)
    expect(strokesOutset([stroke(20, 'outside'), stroke(2, 'outside')])).toBe(20)
  })

  it('ignores a stroke that reaches wide but is not drawn', () => {
    const hidden: Stroke = {
      paint: { ...fromHex('#ff0000'), visible: false },
      weight: 20,
      align: 'outside',
    }
    expect(strokesOutset([hidden, stroke(2, 'outside')])).toBe(2)
  })

  it('stays at zero for inside strokes however many there are', () => {
    expect(strokesOutset([stroke(20, 'inside'), stroke(8, 'inside')])).toBe(0)
  })
})
