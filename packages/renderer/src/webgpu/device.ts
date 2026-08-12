import { WebGPUUnavailableError } from '../Renderer.js'

export interface GPUSurface {
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
}

/**
 * Acquires a device and binds it to the canvas.
 *
 * Three separate things happen here and each can fail on its own, so they are checked
 * separately rather than collapsed into one "WebGPU did not work":
 *
 *   navigator.gpu        does this browser implement the API at all
 *   requestAdapter       is there a GPU this page is allowed to use
 *   requestDevice        can we open a logical device on it
 *
 * A laptop on battery with a blocklisted driver fails at the second, not the first.
 */
export async function createGPUSurface(canvas: HTMLCanvasElement): Promise<GPUSurface> {
  if (!navigator.gpu) {
    throw new WebGPUUnavailableError('This browser does not support WebGPU.')
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) {
    throw new WebGPUUnavailableError('No GPU adapter is available to this page.')
  }

  const device = await adapter.requestDevice()

  const context = canvas.getContext('webgpu')
  if (!context) {
    throw new WebGPUUnavailableError('The canvas did not return a WebGPU context.')
  }

  // The preferred format is bgra8unorm on Apple silicon and rgba8unorm elsewhere. Asking
  // for the wrong one still works but costs a conversion on every present.
  const format = navigator.gpu.getPreferredCanvasFormat()

  context.configure({
    device,
    format,
    // The canvas covers its whole area and nothing shows through it, so the compositor can
    // skip blending the page behind.
    alphaMode: 'opaque',
  })

  return { device, context, format }
}

/**
 * A device can be lost at any time: driver reset, tab backgrounded too long, GPU removed.
 * Every resource on it dies with it, so the only recovery is building a new one.
 */
export function onDeviceLost(device: GPUDevice, handler: (reason: string) => void): void {
  void device.lost.then((info) => {
    // 'destroyed' means we called destroy() ourselves during teardown, which is not a fault.
    if (info.reason === 'destroyed') return
    handler(info.message || 'The GPU device was lost.')
  })
}
