import {
  applyToPoint,
  invert,
  multiply,
  scaling,
  translation,
  type Mat2D,
  type Rect,
  type Vec2,
} from '@canvas/document'

/**
 * View state. Lives with the renderer rather than the document because panning is not an
 * edit: two people looking at the same file are at different places in it.
 */
export interface Camera {
  /** World point at the center of the viewport. */
  x: number
  y: number
  zoom: number
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 }

export interface Viewport {
  width: number
  height: number
}

/**
 * World space to CSS pixel space: (world - camera) * zoom + viewport center.
 *
 * `multiply(m, n)` applies m first, so the order below reads in the order the steps happen.
 */
export function viewMatrix(camera: Camera, viewport: Viewport): Mat2D {
  const toOrigin = translation(-camera.x, -camera.y)
  const zoomed = multiply(toOrigin, scaling(camera.zoom))
  return multiply(zoomed, translation(viewport.width / 2, viewport.height / 2))
}

/**
 * CSS pixels to clip space. Clip space runs -1 to 1 with y pointing up, while pixels start
 * at the top left with y pointing down, so this flips y as well as rescaling.
 *
 * Used on its own by anything measured in screen pixels rather than world units, which is
 * what keeps a selection handle the same size at every zoom level.
 */
export function pixelsToClip(viewport: Viewport): Mat2D {
  return {
    a: 2 / viewport.width,
    b: 0,
    c: 0,
    d: -2 / viewport.height,
    tx: -1,
    ty: 1,
  }
}

/** World space straight to clip space, which is what the shape vertex shader needs. */
export function clipMatrix(camera: Camera, viewport: Viewport): Mat2D {
  return multiply(viewMatrix(camera, viewport), pixelsToClip(viewport))
}

export function screenToWorld(camera: Camera, viewport: Viewport, point: Vec2): Vec2 {
  return applyToPoint(invert(viewMatrix(camera, viewport)), point)
}

export function worldToScreen(camera: Camera, viewport: Viewport, point: Vec2): Vec2 {
  return applyToPoint(viewMatrix(camera, viewport), point)
}

/**
 * The camera that leaves the drawing where it is after the canvas changes shape or place.
 *
 * `camera.x` is the world point at the **centre** of the viewport, which is what makes this
 * necessary: narrow the canvas and its centre moves, so the same camera puts the same world
 * point somewhere else on the display. Nothing about the view changed, but everything in it
 * appears to slide, which is what dragging a side panel looks like, since the panels are grid
 * columns and the canvas is the column between them.
 *
 * Both rects are in page coordinates, so where the canvas sits counts as well as how big it
 * is. Widening the left panel moves the canvas right and narrows it by the same amount, and
 * those two pull the drawing opposite ways: without the origin term, correcting for the width
 * alone would cancel half the slide and double the other half. `getBoundingClientRect` gives
 * both in one call.
 *
 * Falls out of holding a world point's page position still across the change:
 *
 *     origin' + (W - x') * zoom + width' / 2  =  origin + (W - x) * zoom + width / 2
 *
 * `W` drops out, which is the point: every world point is held, not a chosen one. A window
 * resize goes through the same rule and gets the behaviour a canvas should have, the drawing
 * anchored where it was with the new room appearing at the edge that grew.
 */
export function keepAnchored(camera: Camera, before: Rect, after: Rect): Camera {
  return {
    ...camera,
    x: camera.x + (after.x - before.x + (after.width - before.width) / 2) / camera.zoom,
    y: camera.y + (after.y - before.y + (after.height - before.height) / 2) / camera.zoom,
  }
}

/** Zooms around a fixed screen point, which is what a trackpad pinch and a wheel both want. */
export function zoomAt(camera: Camera, viewport: Viewport, point: Vec2, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor)
  const before = screenToWorld(camera, viewport, point)
  const after = screenToWorld({ ...camera, zoom }, viewport, point)
  return { x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y), zoom }
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 256

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function fitTo(rect: Rect, viewport: Viewport, padding = 64): Camera {
  const scale = Math.min(
    (viewport.width - padding * 2) / rect.width,
    (viewport.height - padding * 2) / rect.height,
  )
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    zoom: clampZoom(Number.isFinite(scale) ? scale : 1),
  }
}
