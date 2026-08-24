import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { NodeId, Rect } from '@canvas/document'
import {
  DEFAULT_CAMERA,
  createWebGPURenderer,
  fitTo,
  selectionWorldBounds,
  zoomAt,
  type Camera,
  type Renderer,
  type Viewport,
} from '@canvas/renderer'
import { scene } from '../state/scene'
import { frameStats } from '../state/stats'
import { useUI } from '../state/uiStore'
import { fontMetrics, textLayouts, updateText } from '../state/font'
import { TextEditor } from '../ui/TextEditor'
import { beginEditing, endEditing } from '../state/textEditing'
import { createPointerInput } from '../input/pointerInput'
import { isEditingText } from '../input/isEditingText'
import { registerCapture, type CaptureOptions, type CapturedImage } from '../agent/capture'
import styles from './CanvasHost.module.css'

/** Longest edge of an agent screenshot. Enough to judge layout, cheap to send as tokens. */
const CAPTURE_MAX_EDGE = 1400

/**
 * Owns the canvas element, the GPU device lifecycle and the draw schedule.
 *
 * Everything lives in one effect on purpose. React must mount this surface once and never
 * re-create it: a remount would drop the device and every buffer on it.
 */
export function CanvasHost(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // A ref, not state. The camera changes at pointer rate and no component renders from it,
  // so putting it in state would mean a React render per wheel event for nothing.
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA)
  // Also a ref: it changes on every frame of a rubber band and no component renders from it.
  const marqueeRef = useRef<Rect | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: Renderer | null = null
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
        renderer.render({
          camera: cameraRef.current,
          selection: useUI.getState().selection,
          marquee: marqueeRef.current,
          editing: useUI.getState().editing,
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
      if (!renderer) return
      const rect = canvas.getBoundingClientRect()
      renderer.resize({ width: rect.width, height: rect.height }, window.devicePixelRatio)
      draw()
    }

    const onWheel = (event: WheelEvent): void => {
      // Without this the page zooms and the browser scrolls. Requires passive: false.
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const viewport = { width: rect.width, height: rect.height }
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const camera = cameraRef.current

      if (event.ctrlKey) {
        // A trackpad pinch arrives as a wheel event with ctrlKey set. The browser
        // synthesises it, so there is no separate gesture API to listen to.
        // Exponential rather than linear, so each notch is the same proportional step
        // whether you are at 5% or 500%.
        cameraRef.current = zoomAt(camera, viewport, point, Math.exp(-event.deltaY * 0.01))
      } else {
        // Deltas are in screen pixels, so they divide by zoom to become world units.
        // Otherwise a pan at 400% would fly four times too far.
        cameraRef.current = {
          ...camera,
          x: camera.x + event.deltaX / camera.zoom,
          y: camera.y + event.deltaY / camera.zoom,
        }
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
          cameraRef.current = fitTo(bounds, viewportOf())
          draw()
        }
        return
      }

      if (event.code === 'Digit0' && (event.shiftKey || event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        const camera = cameraRef.current
        const viewport = viewportOf()
        const centre = { x: viewport.width / 2, y: viewport.height / 2 }
        cameraRef.current = zoomAt(camera, viewport, centre, 1 / camera.zoom)
        draw()
      }
    }

    const observer = new ResizeObserver(resize)
    const unsubscribe = scene.subscribe(draw)
    // Selection is drawn but is not in the document, so it needs its own redraw trigger.
    const unsubscribeSelection = useUI.subscribe((state, previous) => {
      // The caret is drawn but is not in the document, so like selection it needs its own
      // trigger. That covers the blink too, which is a change to nothing else.
      if (state.selection !== previous.selection || state.editing !== previous.editing) draw()
    })
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)

    // The stores are read through getState rather than subscribed to. Input runs per pointer
    // event and must see the current tool and selection without a render in between.
    const disposeInput = createPointerInput({
      canvas,
      document: scene,
      getCamera: () => cameraRef.current,
      setCamera: (next) => {
        cameraRef.current = next
      },
      getTool: () => useUI.getState().tool,
      setTool: (tool) => useUI.getState().setTool(tool),
      getSelection: () => useUI.getState().selection,
      setSelection: (ids) => useUI.getState().setSelection(ids),
      toggleInSelection: (id) => useUI.getState().toggleInSelection(id),
      setMarquee: (rect) => {
        marqueeRef.current = rect
      },
      requestDraw: draw,
      beginTextEdit: beginEditing,
      setTextCaret: (caret, anchor) => useUI.getState().setTextCaret(caret, anchor),
      endTextEdit: endEditing,
      getEditing: () => useUI.getState().editing,
      getMetrics: fontMetrics,
      layouts: textLayouts,
      updateText,
    })

    /**
     * The agent's screenshot. The canvas is drawn on demand, so the capture schedules a
     * draw and waits two animation frames: the first runs the render, and by the second the
     * frame has been presented, which is what `drawImage` from a WebGPU canvas reads.
     * Downscaled through a 2D canvas so a retina viewport does not ship megabytes of PNG.
     */
    const captureCanvas = async (options: CaptureOptions): Promise<CapturedImage> => {
      if (!renderer) throw new Error('The canvas is not ready to capture.')

      let bounds: Rect | null = null
      if (options.nodeId) {
        bounds = selectionWorldBounds(scene, [options.nodeId as NodeId])
      } else if (options.fit === 'all') {
        bounds = selectionWorldBounds(
          scene,
          scene.getChildren(scene.rootId).map((node) => node.id),
        )
      } else if (options.fit === 'selection') {
        bounds = selectionWorldBounds(scene, useUI.getState().selection)
      }
      if (bounds) cameraRef.current = fitTo(bounds, viewportOf())

      draw()
      await new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      })

      const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(canvas.width, canvas.height))
      const shot = document.createElement('canvas')
      shot.width = Math.max(1, Math.round(canvas.width * scale))
      shot.height = Math.max(1, Math.round(canvas.height * scale))
      const context = shot.getContext('2d')
      if (!context) throw new Error('Could not read the canvas.')
      context.drawImage(canvas, 0, 0, shot.width, shot.height)
      const url = shot.toDataURL('image/png')
      const base64 = url.slice(url.indexOf(',') + 1)
      if (!base64) throw new Error('The canvas produced an empty image.')
      return { mimeType: 'image/png', base64 }
    }
    const unregisterCapture = registerCapture(captureCanvas)

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

    void createWebGPURenderer(
      { canvas, document: scene, layouts: textLayouts },
      { onLost: setError },
    )
      .then((created) => {
        // The effect can be torn down before the device arrives, and in StrictMode it
        // reliably is. Without this the second mount leaks the first device.
        if (disposed) {
          created.destroy()
          return
        }
        renderer = created
        observer.observe(canvas)
        resize()
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setError(cause instanceof Error ? cause.message : 'The renderer failed to start.')
      })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      unregisterCapture()
      observer.disconnect()
      unsubscribe()
      unsubscribeSelection()
      disposeInput()
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      media?.removeEventListener('change', onPixelRatioChange)
      renderer?.destroy()
      renderer = null
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} />
      <TextEditor />
      {error && <p className={styles.error}>{error}</p>}
    </>
  )
}
