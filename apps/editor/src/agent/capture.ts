/**
 * The agent's eyes: a screenshot of the live canvas.
 *
 * Registered by `CanvasHost` rather than imported from it, because the capture needs the
 * canvas element, the camera ref and the draw schedule, all of which live inside its one
 * effect and must not leak as globals. The executor asks through here and gets null when no
 * renderer is up, which it turns into a message the model can act on.
 */

export interface CaptureOptions {
  /** Move the camera to frame this before capturing. 'view' captures as-is. */
  fit?: 'view' | 'all' | 'selection'
  nodeId?: string
}

export interface CapturedImage {
  mimeType: string
  base64: string
}

export type CaptureFn = (options: CaptureOptions) => Promise<CapturedImage>

let current: CaptureFn | null = null

export function registerCapture(fn: CaptureFn): () => void {
  current = fn
  return () => {
    if (current === fn) current = null
  }
}

export function capture(options: CaptureOptions): Promise<CapturedImage> {
  if (!current) return Promise.reject(new Error('The canvas is not ready to capture.'))
  return current(options)
}
