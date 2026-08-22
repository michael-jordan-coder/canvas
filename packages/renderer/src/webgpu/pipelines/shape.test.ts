import { describe, expect, it } from 'vitest'
import { createStubDevice } from '../testing/stubDevice.js'
import { createShapePipeline } from './shape.js'

/** The layouts are opaque handles to this function, so a stub one is as good as a real one. */
function shapePipeline(): GPURenderPipelineDescriptor {
  const stub = createStubDevice()
  const layout = stub.device.createBindGroupLayout({ entries: [] })
  createShapePipeline(stub.device, 'bgra8unorm', layout, layout, layout)
  const [descriptor] = stub.pipelines()
  if (!descriptor) throw new Error('the shape pipeline was never created')
  return descriptor
}

function blendOf(descriptor: GPURenderPipelineDescriptor): GPUBlendState {
  const blend = descriptor.fragment?.targets[0]?.blend
  if (!blend) throw new Error('the shape pipeline declares no blend state')
  return blend
}

describe('the shape pipeline', () => {
  /*
   * The fragment shader returns premultiplied, so the colour channels already carry their
   * own alpha. A `src-alpha` factor here would apply it a second time and every antialiased
   * edge in the document would composite dark. That renders without erroring, which is what
   * makes it worth pinning as a number rather than trusting to review.
   */
  it('blends a premultiplied source over the destination', () => {
    const blend = blendOf(shapePipeline())
    expect(blend.color).toEqual({
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    })
  })

  it('composites alpha on the same terms as colour', () => {
    const blend = blendOf(shapePipeline())
    expect(blend.alpha).toEqual({
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    })
  })
})
