import { describe, expect, it } from 'vitest'
import { invert, multiply, scaling, translation } from '@canvas/document'
import { createBox, createNodeForTool, placedInParent } from './createGesture'

const start = { x: 100, y: 100 }
const free = { fromCentre: false, constrain: false }

describe('createBox', () => {
  it('is the dragged rect, whichever direction the drag went', () => {
    expect(createBox(start, { x: 140, y: 130 }, free)).toEqual({
      x: 100,
      y: 100,
      width: 40,
      height: 30,
    })
    expect(createBox(start, { x: 60, y: 70 }, free)).toEqual({
      x: 60,
      y: 70,
      width: 40,
      height: 30,
    })
  })

  it('squares to the larger side while shift is held', () => {
    const box = createBox(start, { x: 140, y: 110 }, { fromCentre: false, constrain: true })
    expect(box.width).toBe(40)
    expect(box.height).toBe(40)
  })

  it('grows from the centre while alt is held, doubling the reach', () => {
    expect(createBox(start, { x: 130, y: 120 }, { fromCentre: true, constrain: false })).toEqual({
      x: 70,
      y: 80,
      width: 60,
      height: 40,
    })
  })

  it('is a centred square under alt and shift together', () => {
    expect(createBox(start, { x: 130, y: 110 }, { fromCentre: true, constrain: true })).toEqual({
      x: 70,
      y: 70,
      width: 60,
      height: 60,
    })
  })
})

describe('placedInParent', () => {
  it('is the box itself under an untransformed parent', () => {
    const { origin, size } = placedInParent(invert(translation(0, 0)), {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    })
    expect(origin).toEqual({ x: 10, y: 20 })
    expect(size).toEqual({ width: 30, height: 40 })
  })

  it('lands under the cursor inside a scaled and moved frame', () => {
    // The frame doubles its contents and sits at (100, 100), so a world box of 40 across
    // is 20 in the frame's units and its corner maps back accordingly.
    const parentWorld = multiply(scaling(2), translation(100, 100))
    const { origin, size } = placedInParent(invert(parentWorld), {
      x: 140,
      y: 160,
      width: 40,
      height: 60,
    })
    expect(origin.x).toBeCloseTo(20, 6)
    expect(origin.y).toBeCloseTo(30, 6)
    expect(size.width).toBeCloseTo(20, 6)
    expect(size.height).toBeCloseTo(30, 6)
  })
})

describe('createNodeForTool', () => {
  it('makes the shape the tool names, and nothing for the rest', () => {
    expect(createNodeForTool('rectangle')?.type).toBe('rectangle')
    expect(createNodeForTool('ellipse')?.type).toBe('ellipse')
    expect(createNodeForTool('frame')?.type).toBe('frame')
    expect(createNodeForTool('move')).toBeNull()
    expect(createNodeForTool('text')).toBeNull()
  })
})
