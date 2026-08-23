import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { NodeId, Rect } from '@figma-canvas/document'
import {
  createWebGPURenderer,
  fitTo,
  selectionWorldBounds,
  zoomAt,
  type Renderer,
  type Viewport,
} from '@figma-canvas/renderer'
import { scene } from '../state/scene'
import { frameStats } from '../state/stats'
import { useUI } from '../state/uiStore'
import { viewport as view } from '../state/viewport'
import { fontMetrics, textLayouts, updateText } from '../state/font'
import { TextEditor } from '../ui/TextEditor'
import { beginEditing, endEditing } from '../state/textEditing'
import { createComponentDrop } from '../input/componentDrop'
import { createPointerInput } from '../input/pointerInput'
import { isEditingText } from '../input/isEditingText'
import { ComponentLayer } from './ComponentLayer'
import styles from './CanvasHost.module.css'

/**
 * Shared, so preview mode hands the renderer the same empty array every frame rather than a
 * new one. Nothing compares it, but allocating once a frame to say "nothing is selected" is
 * the kind of waste that is easier not to start.
 */
const EMPTY_SELECTION: readonly NodeId[] = []

/**
 * Owns the canvas element, the GPU device lifecycle and the draw schedule.
 *
 * Everything lives in one effect on purpose. React must mount this surface once and never
 * re-create it: a remount would drop the device and every buffer on it.
 */
export function CanvasHost(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  // Also a ref: it changes on every frame of a rubber band and no component renders from it.
  const marqueeRef = useRef<Rect | null>(null)
  // Where a component dragged out of the panel would land. Same reasoning as the marquee.
  const dropRef = useRef<Rect | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const overlayCanvas = overlayRef.current
    if (!canvas || !overlayCanvas) return

    let renderer: Renderer | null = null
    // True once this effect's renderer is the one being drawn with. See `onLost` below.
    let adopted = false
    let disposed = false
    let frame = 0

    // Drawing is on demand rather than a permanent rAF loop. An editor is static most of
    // the time, and a loop that runs at 120Hz over a still document burns battery to
    // produce identical pixels.
    let lastFrameAt = 0

    const draw = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!renderer) return
        const startedAt = performance.now()
        const ui = useUI.getState()
        renderer.render({
          camera: view.camera,
          // Preview mode draws no selection. The nodes stay selected, so switching back
          // finds the same thing chosen, but an outline and eight handles over a running
          // interface would be the tool talking over the thing it is previewing.
          selection: ui.mode === 'preview' ? EMPTY_SELECTION : ui.selection,
          marquee: marqueeRef.current,
          editing: ui.editing,
          dropPreview: dropRef.current,
        })
        const finishedAt = performance.now()

        frameStats.frameMs = finishedAt - startedAt
        frameStats.intervalMs = lastFrameAt === 0 ? 0 : startedAt - lastFrameAt
        lastFrameAt = startedAt
        const { instances, culled } = renderer.stats
        frameStats.instances = instances
        frameStats.culled = culled
      })
    }

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      // Published before the renderer is told, because the component layer reads the same
      // size to build the same matrix and must not be a frame behind on a window resize.
      view.setSize({ width: rect.width, height: rect.height })
      if (!renderer) return
      renderer.resize({ width: rect.width, height: rect.height }, window.devicePixelRatio)
      draw()
    }

    const onWheel = (event: WheelEvent): void => {
      // Without this the page zooms and the browser scrolls. Requires passive: false.
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const viewport = { width: rect.width, height: rect.height }
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const camera = view.camera

      if (event.ctrlKey) {
        // A trackpad pinch arrives as a wheel event with ctrlKey set. The browser
        // synthesises it, so there is no separate gesture API to listen to.
        // Exponential rather than linear, so each notch is the same proportional step
        // whether you are at 5% or 500%.
        view.setCamera(zoomAt(camera, viewport, point, Math.exp(-event.deltaY * 0.01)))
      } else {
        // Deltas are in screen pixels, so they divide by zoom to become world units.
        // Otherwise a pan at 400% would fly four times too far.
        view.setCamera({
          ...camera,
          x: camera.x + event.deltaX / camera.zoom,
          y: camera.y + event.deltaY / camera.zoom,
        })
      }
      draw()
    }

    /**
     * Shift+1 fits the view to the selection, or to everything if nothing is selected, so it
     * is never a no-op. Shift+0 (and Cmd/Ctrl+0, the more familiar reset-zoom chord) puts the
     * zoom back to 100% around the current view centre rather than snapping to the origin.
     * `.code` rather than `.key`, so this is not tied to what Shift+1 produces on a given
     * keyboard layout.
     */
    // Measured per branch rather than up front: getBoundingClientRect forces a synchronous
    // layout, and this listener sees every keystroke, including the thirty a second a held
    // arrow key produces while the panels are re-rendering from the nudge.
    const viewportOf = (): Viewport => {
      const rect = canvas.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditingText(event.target)) return

      if (event.shiftKey && event.code === 'Digit1') {
        event.preventDefault()
        const selection = useUI.getState().selection
        const ids =
          selection.length > 0 ? selection : scene.getChildren(scene.rootId).map((node) => node.id)
        const bounds = selectionWorldBounds(scene, ids)
        if (bounds) {
          view.setCamera(fitTo(bounds, viewportOf()))
          draw()
        }
        return
      }

      if (event.code === 'Digit0' && (event.shiftKey || event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        const camera = view.camera
        const viewport = viewportOf()
        const centre = { x: viewport.width / 2, y: viewport.height / 2 }
        view.setCamera(zoomAt(camera, viewport, centre, 1 / camera.zoom))
        draw()
      }
    }

    const observer = new ResizeObserver(resize)
    // Observed straight away rather than once the device is up: the component layer needs
    // the viewport size to place anything at all, and it does not wait on a GPU.
    observer.observe(canvas)
    resize()
    const unsubscribe = scene.subscribe(draw)
    // Selection is drawn but is not in the document, so it needs its own redraw trigger.
    const unsubscribeSelection = useUI.subscribe((state, previous) => {
      // The caret is drawn but is not in the document, so like selection it needs its own
      // trigger. That covers the blink too, which is a change to nothing else.
      if (
        state.selection !== previous.selection ||
        state.editing !== previous.editing ||
        state.mode !== previous.mode
      ) {
        draw()
      }
    })
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)

    // The stores are read through getState rather than subscribed to. Input runs per pointer
    // event and must see the current tool and selection without a render in between.
    const disposeInput = createPointerInput({
      canvas,
      document: scene,
      getCamera: () => view.camera,
      setCamera: (next) => view.setCamera(next),
      getTool: () => useUI.getState().tool,
      getMode: () => useUI.getState().mode,
      setTool: (tool) => useUI.getState().setTool(tool),
      getSelection: () => useUI.getState().selection,
      setSelection: (ids) => useUI.getState().setSelection(ids),
      toggleInSelection: (id) => useUI.getState().toggleInSelection(id),
      setMarquee: (rect) => {
        marqueeRef.current = rect
      },
      requestDraw: draw,
      beginTextEdit: beginEditing,
      enterComponentSource: (id, component) =>
        useUI.getState().enterComponentSource(id, component),
      setTextCaret: (caret, anchor) => useUI.getState().setTextCaret(caret, anchor),
      endTextEdit: endEditing,
      getEditing: () => useUI.getState().editing,
      getMetrics: fontMetrics,
      layouts: textLayouts,
      updateText,
    })

    // devicePixelRatio changes when the window moves to a different display, and no resize
    // event fires for it. This media query is the only notification available.
    let media: MediaQueryList | null = null
    function onPixelRatioChange(): void {
      resize()
      watchPixelRatio()
    }
    function watchPixelRatio(): void {
      media?.removeEventListener('change', onPixelRatioChange)
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      media.addEventListener('change', onPixelRatioChange)
    }
    watchPixelRatio()

    const disposeDrop = createComponentDrop({
      canvas,
      document: scene,
      getCamera: () => view.camera,
      getViewport: viewportOf,
      setSelection: (ids) => useUI.getState().setSelection(ids),
      setDropPreview: (rect) => {
        dropRef.current = rect
      },
      requestDraw: draw,
    })

    void createWebGPURenderer(
      { canvas, overlayCanvas, document: scene, layouts: textLayouts },
      {
        /*
         * Only the renderer that was actually adopted may report a loss.
         *
         * In StrictMode two devices are requested and one of them is thrown away as soon as
         * it arrives. Its death is not a fault the user can act on, and reporting it puts a
         * GPU failure on screen while a perfectly healthy renderer is drawing behind it.
         * Worse now than before: the overlay surface hides itself when the renderer has
         * failed, so a loss reported for a device nobody is using would take the selection
         * outline and every handle with it.
         */
        onLost: (reason) => {
          if (adopted) setError(reason)
        },
      },
    )
      .then((created) => {
        // The effect can be torn down before the device arrives, and in StrictMode it
        // reliably is. Without this the second mount leaks the first device.
        if (disposed) {
          created.destroy()
          return
        }
        renderer = created
        adopted = true
        resize()
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setError(cause instanceof Error ? cause.message : 'The renderer failed to start.')
      })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      unsubscribe()
      unsubscribeSelection()
      disposeInput()
      disposeDrop()
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      media?.removeEventListener('change', onPixelRatioChange)
      renderer?.destroy()
      renderer = null
    }
  }, [])

  /*
   * Three layers, and the order is the whole arrangement:
   *
   *   the document        drawn by the GPU, opaque
   *   the component layer real React components, mounted through React DOM
   *   the overlay         drawn by the GPU, transparent: outline, handles, marquee, caret
   *
   * A frame's fill has to be behind the components it contains, and a selected component's
   * outline and handles have to be in front of it, which is why the renderer draws into two
   * surfaces rather than one. The three are stacked here, together, because nothing else in
   * the app can see that this order is what makes both true.
   */
  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} />
      <ComponentLayer />
      <canvas ref={overlayRef} className={styles.overlay} data-failed={error !== null} />
      <TextEditor />
      {error && <p className={styles.error}>{error}</p>}
    </>
  )
}
