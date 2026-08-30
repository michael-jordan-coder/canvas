import type { Camera, Viewport } from '@canvas/renderer'

/** Where the canvas is looking, as of the frame that was just drawn. */
export interface CanvasView {
  camera: Camera
  viewport: Viewport
}

/**
 * The camera, published once per drawn frame for the few DOM things that have to sit on top
 * of the canvas at a world position.
 *
 * It is deliberately not React state and not the UI store. The camera changes at pointer
 * rate, so a store would put a React render between the pointer and the pixels on every
 * frame of a pan, which is the same reason `CanvasHost` holds it in a ref. A subscriber here
 * gets the numbers and moves an element itself.
 */
let current: CanvasView | null = null
const listeners = new Set<(view: CanvasView) => void>()

export function publishCanvasView(view: CanvasView): void {
  current = view
  for (const listener of listeners) listener(view)
}

/** The last published view, for a subscriber that mounts between two frames. */
export function canvasView(): CanvasView | null {
  return current
}

/**
 * Ask the canvas for a frame. Drawing is on demand, so a subscriber that mounts while the
 * document and the camera are both still has nothing to wait for: the last frame may have
 * been drawn long before it existed. One draw gives it a view to place itself from.
 */
let request: (() => void) | null = null

export function registerCanvasDraw(draw: () => void): () => void {
  request = draw
  return () => {
    if (request === draw) request = null
  }
}

export function requestCanvasView(): void {
  request?.()
}

export function subscribeCanvasView(listener: (view: CanvasView) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
