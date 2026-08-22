import {
  applyToPoint,
  containerAt,
  invert,
  type NodeId,
  type Rect,
  type SceneDocument,
} from '@figma-canvas/document'
import { screenToWorld, type Camera, type Viewport } from '@figma-canvas/renderer'
import type { ComponentSpec } from '../components/registry'
import { insertComponent } from '../state/componentNodes'

/**
 * Dragging a component out of the panel and onto the canvas.
 *
 * Native drag and drop rather than pointer events, which is the one place in this editor
 * that is true. The gesture starts on a panel button and ends on the canvas, so it crosses
 * two elements that know nothing about each other, and the platform already owns exactly
 * that: the drag image, the cursor, the escape key and the drop that never happens.
 */

/** Ours alone, so a file or a link dragged onto the canvas is ignored rather than mis-parsed. */
const COMPONENT_MIME = 'application/x-figma-canvas-component'

/**
 * What is currently being dragged, or null.
 *
 * A module level value rather than something read back off the DataTransfer, because the
 * platform deliberately hides a drag's data until it is dropped: during `dragover` only the
 * list of types is readable. The drop preview needs to know how big the thing will be on
 * every move, and both ends of this drag are in the same document, so there is nothing to
 * gain from pretending otherwise.
 */
let dragging: ComponentSpec | null = null

export function beginComponentDrag(spec: ComponentSpec, transfer: DataTransfer): void {
  dragging = spec
  // Set even though nothing reads it back: the type is what makes the canvas recognise this
  // drag as one of its own rather than as some other page's, and a DataTransfer with no data
  // at all is not a valid drag in every browser.
  transfer.setData(COMPONENT_MIME, spec.key)
  transfer.effectAllowed = 'copy'
}

export function endComponentDrag(): void {
  dragging = null
}

/** Whether a drag event is carrying one of our components. */
function carriesComponent(event: DragEvent): boolean {
  return dragging !== null && (event.dataTransfer?.types.includes(COMPONENT_MIME) ?? false)
}

export interface ComponentDropOptions {
  canvas: HTMLCanvasElement
  document: SceneDocument
  getCamera: () => Camera
  getViewport: () => Viewport
  setSelection: (ids: readonly NodeId[]) => void
  /** Where the component would land, in CSS pixels, for the overlay to draw. */
  setDropPreview: (rect: Rect | null) => void
  requestDraw: () => void
}

export function createComponentDrop(options: ComponentDropOptions): () => void {
  const { canvas, document } = options

  const screenOf = (event: DragEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onDragOver = (event: DragEvent): void => {
    if (!carriesComponent(event) || !dragging) return
    // Without this the drop never fires: the default action for a dragover is to refuse it.
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'

    const screen = screenOf(event)
    const zoom = options.getCamera().zoom
    // The component's own size, scaled to the screen, centred on the pointer, which is where
    // `insertComponent` will put it. Drawn by the overlay pass rather than in the DOM, since
    // drag feedback is screen space furniture in exactly the sense the marquee is.
    const width = (dragging.defaultWidth ?? dragging.fallbackSize.width) * zoom
    const height = dragging.fallbackSize.height * zoom
    options.setDropPreview({
      x: screen.x - width / 2,
      y: screen.y - height / 2,
      width,
      height,
    })
    options.requestDraw()
  }

  const clearPreview = (): void => {
    options.setDropPreview(null)
    options.requestDraw()
  }

  const onDragLeave = (): void => {
    clearPreview()
  }

  const onDrop = (event: DragEvent): void => {
    const spec = dragging
    if (!carriesComponent(event) || !spec) return
    event.preventDefault()
    clearPreview()
    endComponentDrag()

    const world = screenToWorld(options.getCamera(), options.getViewport(), screenOf(event))
    // Whatever frame the pointer is over becomes the parent, the same rule a drawn shape
    // follows, so a component dropped into a frame moves with that frame afterwards.
    const target = containerAt(document, world)
    const local = applyToPoint(invert(document.worldTransform(target.id)), world)

    // One transaction, so the insert and the selection that follows it are one undo step and
    // redo restores the selection this drop actually produced.
    document.transact(() => {
      const node = insertComponent(document, spec, target.id, local)
      options.setSelection([node.id])
    })
  }

  canvas.addEventListener('dragover', onDragOver)
  canvas.addEventListener('dragleave', onDragLeave)
  canvas.addEventListener('drop', onDrop)

  return () => {
    canvas.removeEventListener('dragover', onDragOver)
    canvas.removeEventListener('dragleave', onDragLeave)
    canvas.removeEventListener('drop', onDrop)
  }
}
