import { WebGPUUnavailableError } from '../Renderer.js'

export interface GPUSurface {
  device: GPUDevice
  /** The document's surface. Opaque, and the bottom of the three layers on screen. */
  context: GPUCanvasContext
  /**
   * The selection overlay's surface. Transparent, and the top of the three.
   *
   * A second canvas rather than a second pass on the first one, because the DOM layer that
   * mounts React components sits between them. The document has to be under those components
   * (a frame's fill is behind what it contains) and the outline and handles have to be over
   * them (a selected component still shows its own box), and one surface cannot be in two
   * places at once.
   */
  overlay: GPUCanvasContext
  format: GPUTextureFormat
}

/**
 * Which device last configured a given canvas's context.
 *
 * A canvas has exactly one WebGPU context however many renderers get built on it, and in
 * StrictMode two of them are: React mounts, tears down, and mounts again, so a renderer can
 * still be starting up when its effect is already gone. Whichever finishes last owns the
 * context, and the loser must not unconfigure on its way out. Doing so blanks the live
 * renderer, and it presents as the GPU failing rather than as a lifecycle bug, because every
 * later frame throws "context is not configured" from a perfectly healthy device.
 */
const configuredBy = new WeakMap<GPUCanvasContext, GPUDevice>()

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
export async function createGPUSurface(
  canvas: HTMLCanvasElement,
  overlayCanvas: HTMLCanvasElement,
): Promise<GPUSurface> {
  if (!navigator.gpu) {
    throw new WebGPUUnavailableError('This browser does not support WebGPU.')
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) {
    throw new WebGPUUnavailableError('No GPU adapter is available to this page.')
  }

  const device = await adapter.requestDevice()

  // The preferred format is bgra8unorm on Apple silicon and rgba8unorm elsewhere. Asking
  // for the wrong one still works but costs a conversion on every present.
  const format = navigator.gpu.getPreferredCanvasFormat()

  // The document's surface covers its whole area and nothing shows through it, so the
  // compositor can skip blending the page behind it.
  const context = configure(device, canvas, format, 'opaque')
  /*
   * The overlay's surface is nearly all transparent, so it has to be composited over what is
   * beneath it: the React components, and the document below them.
   *
   * Premultiplied is what the pass already produces. The overlay pipeline blends with
   * `src-alpha / one-minus-src-alpha` on colour and `one / one-minus-src-alpha` on alpha, so
   * against a cleared, fully transparent target the result is `rgb * a` with alpha `a`, which
   * is premultiplied by definition. No shader and no blend state changes for the split.
   */
  const overlay = configure(device, overlayCanvas, format, 'premultiplied')

  return { device, context, overlay, format }
}

function configure(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  format: GPUTextureFormat,
  alphaMode: GPUCanvasAlphaMode,
): GPUCanvasContext {
  const context = canvas.getContext('webgpu')
  if (!context) {
    throw new WebGPUUnavailableError('The canvas did not return a WebGPU context.')
  }
  context.configure({ device, format, alphaMode })
  configuredBy.set(context, device)
  return context
}

/**
 * Releases a surface, leaving the canvas alone if something else has since taken it over.
 *
 * The device is always destroyed, because it is this renderer's own. The context is shared
 * canvas state, so it is only unconfigured while this device is still the one holding it.
 */
export function releaseGPUSurface(surface: GPUSurface): void {
  for (const context of [surface.context, surface.overlay]) {
    if (configuredBy.get(context) !== surface.device) continue
    configuredBy.delete(context)
    context.unconfigure()
  }
  surface.device.destroy()
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
