import type { NodeId, Rect, SceneDocument, TextLayoutCache } from '@figma-canvas/document'
import type { Camera, Viewport } from './camera.js'

export interface RendererInit {
  canvas: HTMLCanvasElement
  /**
   * The surface the selection overlay is drawn on, stacked above the component layer while
   * `canvas` sits below it. Separate elements because the DOM between them is what a single
   * surface could not be on both sides of.
   */
  overlayCanvas: HTMLCanvasElement
  document: SceneDocument
  /**
   * Where laid out text is kept, shared with the app rather than owned here.
   *
   * The renderer packs the glyphs, but the editor measures the bounds it writes onto a node
   * and the input layer maps a click to an offset, and all three want the same answer for the
   * same node in the same frame. Passed in for the same reason `ViewState` is: the dependency
   * has to keep pointing one way, and the app is what outlives a renderer being recreated.
   */
  layouts: TextLayoutCache
}

/**
 * Everything a frame needs that is not in the document.
 *
 * Selection is here rather than in the scene because it is not part of the file: two people
 * with the same document open have their own. The renderer is told about it once per frame
 * instead of reading it, which keeps the dependency pointing one way.
 */
/**
 * Where the caret is in the text node being edited.
 *
 * Offsets rather than geometry, for the same reason selection is ids rather than rectangles:
 * the renderer already lays the text out to draw it, so handing it positions would mean two
 * layouts that could disagree, and a caret that disagrees sits beside the text.
 *
 * `caret` is the end that moves and `anchor` the end that does not. They are equal when
 * there is no range selected. Both are UTF-16 offsets, matching the textarea they come from.
 */
export interface TextEditing {
  id: NodeId
  caret: number
  anchor: number
  /** Blinking is a view concern, so the renderer is told when to hide it rather than timing it. */
  caretVisible: boolean
}

export interface ViewState {
  camera: Camera
  selection: readonly NodeId[]
  /** The rubber band rectangle while one is being dragged, in CSS pixels. */
  marquee?: Rect | null
  /** The text node being edited, or null when nothing is. */
  editing?: TextEditing | null
  /**
   * Where a component dragged out of the component panel would land, in CSS pixels, or null
   * when nothing is being dragged in.
   *
   * Drawn here rather than by the DOM layer that will eventually mount the component,
   * because drag feedback is overlay furniture in exactly the sense the marquee and the
   * handles are: it is measured in screen pixels, it is not in the document, and it has to
   * sit above everything the canvas draws.
   */
  dropPreview?: Rect | null
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
