import type { NodeId, Rect, SceneDocument } from '@figma-canvas/document'
import type { Camera, Viewport } from '../camera.js'
import {
  handlePoints,
  selectionScreenBounds,
  HANDLE_SIZE,
  OUTLINE_WIDTH,
} from '../selection.js'

/** rect (4) + fill (4) + stroke (4) + params (4). Same stride as a shape instance. */
const FLOATS_PER_INSTANCE = 16
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4

/**
 * Mirrors --accent in the editor's tokens. Hardcoded because the renderer has no access to
 * CSS. It will need passing in when the theme toggle exists, since dark uses a lighter blue.
 */
const ACCENT = { r: 10 / 255, g: 124 / 255, b: 1, a: 1 }
const HANDLE_FILL = { r: 1, g: 1, b: 1, a: 1 }
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 }
/** Faint enough to read what is underneath, which is the whole point of a rubber band. */
const MARQUEE_FILL = { r: 10 / 255, g: 124 / 255, b: 1, a: 0.1 }


/**
 * The selection outline and its handles, built fresh every frame in CSS pixels.
 *
 * Rebuilt unconditionally rather than cached against a version, because it depends on the
 * camera: panning changes every number in here. It is a handful of instances, so the cost
 * is nothing next to the correctness of never showing a stale outline.
 */
export class OverlayInstances {
  #device: GPUDevice
  #buffer: GPUBuffer | null = null
  #capacity = 0
  #data = new Float32Array(0)
  #count = 0

  constructor(device: GPUDevice) {
    this.#device = device
  }

  get count(): number {
    return this.#count
  }

  get buffer(): GPUBuffer | null {
    return this.#buffer
  }

  sync(
    document: SceneDocument,
    selection: readonly NodeId[],
    camera: Camera,
    viewport: Viewport,
    marquee?: Rect | null,
  ): void {
    this.#count = 0

    if (marquee) {
      // Already in CSS pixels, so it needs no camera at all: the rubber band is drawn where
      // the pointer is, not where the world is.
      this.#push(marquee, MARQUEE_FILL, ACCENT, OUTLINE_WIDTH, 0)
    }

    // The same box the input layer hit tests against, so what you can grab is what you see.
    const outline =
      selection.length > 0
        ? selectionScreenBounds(document, selection, camera, viewport)
        : null

    if (!outline) {
      if (this.#count > 0) this.#upload()
      return
    }

    this.#push(outline, TRANSPARENT, ACCENT, OUTLINE_WIDTH, 0)

    for (const { x, y } of handlePoints(outline)) {
      const centreX = Math.round(x)
      const centreY = Math.round(y)
      this.#push(
        {
          x: centreX - HANDLE_SIZE / 2,
          y: centreY - HANDLE_SIZE / 2,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
        },
        HANDLE_FILL,
        ACCENT,
        OUTLINE_WIDTH,
        1,
      )
    }

    this.#upload()
  }

  #push(
    rect: Rect,
    fill: { r: number; g: number; b: number; a: number },
    stroke: { r: number; g: number; b: number; a: number },
    strokeWidth: number,
    cornerRadius: number,
  ): void {
    this.#reserve(this.#count + 1)
    const at = this.#count * FLOATS_PER_INSTANCE

    this.#data[at + 0] = rect.x
    this.#data[at + 1] = rect.y
    this.#data[at + 2] = rect.width
    this.#data[at + 3] = rect.height

    this.#data[at + 4] = fill.r
    this.#data[at + 5] = fill.g
    this.#data[at + 6] = fill.b
    this.#data[at + 7] = fill.a

    this.#data[at + 8] = stroke.r
    this.#data[at + 9] = stroke.g
    this.#data[at + 10] = stroke.b
    this.#data[at + 11] = stroke.a

    this.#data[at + 12] = strokeWidth
    this.#data[at + 13] = cornerRadius
    this.#data[at + 14] = 0
    this.#data[at + 15] = 0

    this.#count += 1
  }

  #reserve(needed: number): void {
    if (needed <= this.#capacity) return
    const capacity = Math.max(32, this.#capacity * 2, needed)
    const data = new Float32Array(capacity * FLOATS_PER_INSTANCE)
    data.set(this.#data)
    this.#data = data
    this.#capacity = capacity
    this.#buffer?.destroy()
    this.#buffer = this.#device.createBuffer({
      label: 'overlay instances',
      size: capacity * BYTES_PER_INSTANCE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }

  #upload(): void {
    if (!this.#buffer || this.#count === 0) return
    this.#device.queue.writeBuffer(
      this.#buffer,
      0,
      this.#data.buffer,
      this.#data.byteOffset,
      this.#count * BYTES_PER_INSTANCE,
    )
  }

  destroy(): void {
    this.#buffer?.destroy()
    this.#buffer = null
  }
}
