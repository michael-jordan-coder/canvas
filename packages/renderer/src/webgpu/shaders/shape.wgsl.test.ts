import { describe, expect, it } from 'vitest'
import source from './shape.wgsl?raw'

/*
 * The one line of WGSL that has to agree with something outside the file. The pipeline's
 * blend state assumes a premultiplied source, and nothing checks that assumption at compile
 * time: a straight-alpha return still compiles, still draws, and is only wrong by a shade
 * along every edge. Reading the source is crude, but it is the only way to hold the two
 * halves of one contract together without a GPU.
 */
describe('shape.wgsl', () => {
  it('returns a premultiplied colour, which the pipeline blend state assumes', () => {
    expect(source).toContain('return vec4f(in.color.rgb * a, a);')
  })

  it('folds coverage into that alpha rather than into the colour separately', () => {
    expect(source).toContain('let a = in.color.a * coverage;')
  })
})
