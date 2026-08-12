import type { NodeId, Rect, SceneDocument } from '@figma-canvas/document'
import type { Camera, Viewport } from './camera.js'

export interface RendererInit {
  canvas: HTMLCanvasElement
  document: SceneDocument
}

/**
 * Everything a frame needs that is not in the document.
 *
 * Selection is here rather than in the scene because it is not part of the file: two people
 * with the same document open have their own. The renderer is told about it once per frame
 * instead of reading it, which keeps the dependency pointing one way.
 */
export interface ViewState {
  camera: Camera
  selection: readonly NodeId[]
  /** The rubber band rectangle while one is being dragged, in CSS pixels. */
  marquee?: Rect | null
}

/**
 * The contract the app holds. Everything above this line (panels, input, tools) is written
 * against this interface and never against WebGPU itself, so the backend stays replaceable
 * and testable without a GPU.
 */
export interface RendererStats {
  /** Instances submitted by the last frame. */
  instances: number
  /** Instances skipped as off screen by the last instance buffer build. */
  culled: number
}

export interface Renderer {
  readonly stats: RendererStats
  /**
   * `viewport` is CSS pixels, `dpr` is the device pixel ratio. The renderer owns the
   * backing store size, the host only reports what the element measured.
   */
  resize(viewport: Viewport, dpr: number): void
  /** Draws one frame. The caller owns the loop, so scheduling policy is not baked in here. */
  render(view: ViewState): void
  destroy(): void
}

export class WebGPUUnavailableError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'WebGPUUnavailableError'
  }
}
