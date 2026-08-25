import type {
  FontMetrics,
  NodeId,
  Rect,
  SceneDocument,
  TextLayoutCache,
} from '@canvas/document'
import type { Camera, Viewport } from '../camera.js'
import type { TextEditing } from '../Renderer.js'
import {
  fromBoxSpace,
  handlePoints,
  rotateHandlePoint,
  resizeHandlesFor,
  selectionBox,
  textEditingBoxes,
  HANDLE_SIZE,
  OUTLINE_WIDTH,
  ROTATE_HANDLE_SIZE,
} from '../selection.js'
import type { Size, Vec2 } from '@canvas/document'

/** A rect of the given size around a centre point. */
function centredAt(centre: Vec2, size: Size): Rect {
  return {
    x: centre.x - size.width / 2,
    y: centre.y - size.height / 2,
    width: size.width,
    height: size.height,
  }
}

/** rect (4) + fill (4) + stroke (4) + params (4). Same stride as a shape instance. */
const FLOATS_PER_INSTANCE = 16
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4

/**
 * Mirrors --accent in the editor's tokens. Hardcoded because the renderer has no access to
 * CSS. It will need passing in when the theme toggle exists, since dark uses a lighter blue.
 */
const ACCENT = { r: 10 / 255, g: 124 / 255, b: 1, a: 1 }
/**
 * Code nodes get their own accent, the way a component instance does in Figma: what the
 * outline says is not only "this is selected" but "this one is written, not drawn", and the
 * handles around it edit a node whose children answer to its source.
 */
const CODE_ACCENT = { r: 34 / 255, g: 211 / 255, b: 116 / 255, a: 1 }
const HANDLE_FILL = { r: 1, g: 1, b: 1, a: 1 }
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 }
/** Faint enough to read what is underneath, which is the whole point of a rubber band. */
const MARQUEE_FILL = { r: 10 / 255, g: 124 / 255, b: 1, a: 0.1 }
/**
 * The text selection highlight sits under the glyphs it covers, so it has to stay light
 * enough to read them through. Matching --accent-subtle in the editor's tokens.
 */
const TEXT_SELECTION_FILL = { r: 10 / 255, g: 124 / 255, b: 1, a: 0.25 }
/**
 * Which accent a box is drawn in. Green only when every node in the box is a code node: a
 * mixed selection has no single story to tell, so it falls back to the ordinary one.
 */
function accentFor(
  document: SceneDocument,
  ids: readonly NodeId[],
): { r: number; g: number; b: number; a: number } {
  if (ids.length === 0) return ACCENT
  for (const id of ids) {
    if (document.getNode(id)?.type !== 'code') return ACCENT
  }
  return CODE_ACCENT
}

/** The caret is the one thing here that is not accent coloured: it stands in for the text. */
const CARET_FILL = { r: 0.1, g: 0.1, b: 0.1, a: 1 }


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

  #metrics: FontMetrics
  #layouts: TextLayoutCache

  constructor(device: GPUDevice, metrics: FontMetrics, layouts: TextLayoutCache) {
    this.#device = device
    this.#metrics = metrics
    this.#layouts = layouts
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
    editing?: TextEditing | null,
    hover?: NodeId | null,
  ): void {
    this.#count = 0

    if (marquee) {
      // Already in CSS pixels, so it needs no camera at all: the rubber band is drawn where
      // the pointer is, not where the world is. Never rotated, whatever is selected.
      this.#push(marquee, MARQUEE_FILL, ACCENT, OUTLINE_WIDTH, 0, 0)
    }

    /*
     * Editing a text node replaces the handles with a caret. The eight resize handles would
     * be a lie while the text is being typed, since the bounds follow the text rather than
     * the other way round, and the caret has to be the thing the pointer is aiming at.
     */
    if (editing) {
      const boxes = textEditingBoxes(
        document,
        editing,
        this.#metrics,
        this.#layouts,
        camera,
        viewport,
      )
      if (boxes) {
        // The highlight first, so the caret is never buried under it.
        for (const rect of boxes.selection) {
          this.#push(rect, TEXT_SELECTION_FILL, TRANSPARENT, 0, 0, boxes.angle)
        }
        if (editing.caretVisible) {
          this.#push(boxes.caret, CARET_FILL, TRANSPARENT, 0, 0, boxes.angle)
        }
      }
      this.#upload()
      return
    }

    /*
     * The hover outline: the four edges of what a click would select, and nothing else.
     *
     * The same `selectionBox` and the same single `#push` the selection outline below is
     * built from, deliberately rather than by a parallel path, so a hovered box and a
     * selected one cannot end up drawn in two different places under rotation or a scaled
     * parent. What it leaves out is everything a handle does: the corner squares, the edge
     * squares and the rotate stem are affordances for a gesture, and offering them to a
     * pointer that has not selected anything yet would say the shape can be resized when
     * clicking it would only select it.
     *
     * Drawn before the selection so a node that is both stays outlined by the selection's
     * pass, and skipped outright when it is already selected, since a second outline exactly
     * on top of the first is invisible work that only shows up as a seam.
     */
    if (hover && !selection.includes(hover)) {
      const hovered = selectionBox(document, [hover], camera, viewport)
      if (hovered) {
        const accent = accentFor(document, [hover])
        this.#push(hovered.rect, TRANSPARENT, accent, OUTLINE_WIDTH, 0, hovered.angle)
      }
    }

    // The same box the input layer hit tests against, so what you can grab is what you see.
    const box = selection.length > 0 ? selectionBox(document, selection, camera, viewport) : null

    if (!box) {
      if (this.#count > 0) this.#upload()
      return
    }

    const accent = accentFor(document, selection)

    this.#push(box.rect, TRANSPARENT, accent, OUTLINE_WIDTH, 0, box.angle)

    // The stem first, so the round handle lands on top of the end of it rather than the
    // other way round. Each is centred in the box's frame, mapped to where that centre is
    // actually drawn, and then turned about itself. A rotation is rigid, so turning a quad
    // about its own centre at the rotated centre is the same thing as turning the whole box.
    const rotateAt = rotateHandlePoint(box.rect)
    const stem = centredAt(fromBoxSpace(box, { x: rotateAt.x, y: (box.rect.y + rotateAt.y) / 2 }), {
      width: OUTLINE_WIDTH,
      height: box.rect.y - rotateAt.y,
    })
    this.#push(stem, accent, TRANSPARENT, 0, 0, box.angle)

    const knob = centredAt(fromBoxSpace(box, rotateAt), {
      width: ROTATE_HANDLE_SIZE,
      height: ROTATE_HANDLE_SIZE,
    })
    // A corner radius of half the side turns the rounded box into a circle, so the round
    // handle costs nothing beyond the number in that slot.
    this.#push(knob, HANDLE_FILL, accent, OUTLINE_WIDTH, ROTATE_HANDLE_SIZE / 2, box.angle)

    for (const point of handlePoints(box.rect, resizeHandlesFor(document, selection))) {
      // Handle centres come out in the box's own upright frame, so each one is placed where
      // it is actually drawn before the quad is built around it.
      const placed = fromBoxSpace(box, point)
      const centreX = Math.round(placed.x)
      const centreY = Math.round(placed.y)
      this.#push(
        {
          x: centreX - HANDLE_SIZE / 2,
          y: centreY - HANDLE_SIZE / 2,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
        },
        HANDLE_FILL,
        accent,
        OUTLINE_WIDTH,
        1,
        // Turned with the box, so a handle reads as a corner of the shape rather than an
        // upright pip sitting loose on top of it.
        box.angle,
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
    angle: number,
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
    this.#data[at + 14] = angle
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
