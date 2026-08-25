import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_GRADIENT_STOPS, type GradientPaint } from '@canvas/document'
import { GradientRamps } from './GradientRamps.js'
import { createStubDevice, type StubDevice } from './testing/stubDevice.js'

const linear = (stops: GradientPaint['stops']): GradientPaint => ({
  type: 'linear',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
  stops,
})

const stop = (position: number, r = 1): GradientPaint['stops'][number] => ({
  position,
  color: { r, g: 0.5, b: 0.25, a: 0.75 },
})

let stub: StubDevice
let ramps: GradientRamps

beforeEach(() => {
  stub = createStubDevice()
  ramps = new GradientRamps(stub.device)
})

describe('GradientRamps', () => {
  it('packs a header and its stops as consecutive 8 float records', () => {
    const index = ramps.push(linear([stop(0), stop(1, 0)]))
    ramps.upload()
    const data = stub.written('gradient ramps')

    // The first gradient's header starts the buffer, so its vec4 index is 0.
    expect(index).toBe(0)
    // from, to.
    expect([...data.slice(0, 4)]).toEqual([0, 0, 1, 0])
    // stopStart in vec4s, stopCount, kind (0 linear), pad.
    expect([...data.slice(4, 8)]).toEqual([2, 2, 0, 0])
    // First stop: colour, then position in its own record.
    expect([...data.slice(8, 12)]).toEqual([1, 0.5, 0.25, 0.75])
    expect(data[12]).toBe(0)
    // Second stop.
    expect([...data.slice(16, 20)]).toEqual([0, 0.5, 0.25, 0.75])
    expect(data[20]).toBe(1)
  })

  it('marks a radial gradient by kind', () => {
    ramps.push({ ...linear([stop(0)]), type: 'radial' })
    ramps.upload()
    expect(stub.written('gradient ramps')[6]).toBe(1)
  })

  it('hands out indices that step past each gradient and its stops', () => {
    const first = ramps.push(linear([stop(0), stop(0.5), stop(1)]))
    const second = ramps.push(linear([stop(0)]))
    // The first occupied 1 header + 3 stops = 4 records = 8 vec4s.
    expect(first).toBe(0)
    expect(second).toBe(8)
    ramps.upload()
    // The second header's stopStart points just past itself.
    expect(stub.written('gradient ramps')[8 * 4 + 4]).toBe(10)
  })

  it('caps the stops it will pack, the walk bound the shader depends on', () => {
    const stops = Array.from({ length: MAX_GRADIENT_STOPS + 4 }, (_, i) => stop(i / 12))
    ramps.push(linear(stops))
    ramps.upload()
    expect(stub.written('gradient ramps')[5]).toBe(MAX_GRADIENT_STOPS)
  })

  it('survives growth without losing what was already packed', () => {
    // Enough gradients to force the buffer past its floor of 8 records several times.
    const indices = Array.from({ length: 24 }, (_, i) =>
      ramps.push(linear([stop(0, i / 24), stop(1)])),
    )
    ramps.upload()
    const data = stub.written('gradient ramps')
    // Every header still holds its own stops' start, so nothing was lost in a copy.
    for (const [i, index] of indices.entries()) {
      expect(data[index * 4 + 4]).toBe(index + 2)
      expect(data[(index + 2) * 4]).toBeCloseTo(i / 24, 6)
    }
  })

  it('starts over on reset, reusing the buffer', () => {
    ramps.push(linear([stop(0)]))
    ramps.reset()
    expect(ramps.count).toBe(0)
    const index = ramps.push(linear([stop(1)]))
    expect(index).toBe(0)
  })
})
