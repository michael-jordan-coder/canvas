import { DEFAULT_CAMERA, type Camera, type Viewport } from '@figma-canvas/renderer'

type Listener = () => void

/**
 * The camera and the size of the surface it is looking through, shared by the two layers
 * that have to agree about them exactly.
 *
 * This used to be a ref inside `CanvasHost`, which was right while the canvas was the only
 * thing being positioned by it. The DOM layer that mounts React components needs the same
 * numbers, and "the same numbers" has to mean the same object rather than two copies that
 * are usually equal: a component that lags the canvas by one frame during a pan is exactly
 * the artefact this whole design exists to avoid.
 *
 * Deliberately not Zustand and deliberately not React state. It changes at pointer rate, and
 * a React render per wheel event is the cost this architecture refuses to pay. Subscribers
 * are imperative and write a transform, which is one style property per camera change.
 */
class ViewportState {
  #camera: Camera = DEFAULT_CAMERA
  #size: Viewport = { width: 1, height: 1 }
  #listeners = new Set<Listener>()

  get camera(): Camera {
    return this.#camera
  }

  /** The canvas in CSS pixels. The DOM layer covers exactly this box. */
  get size(): Viewport {
    return this.#size
  }

  setCamera(camera: Camera): void {
    if (
      camera.x === this.#camera.x &&
      camera.y === this.#camera.y &&
      camera.zoom === this.#camera.zoom
    ) {
      return
    }
    this.#camera = camera
    this.#notify()
  }

  setSize(size: Viewport): void {
    if (size.width === this.#size.width && size.height === this.#size.height) return
    this.#size = size
    this.#notify()
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

export const viewport = new ViewportState()
