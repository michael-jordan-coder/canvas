import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  DEFAULT_CAMERA,
  createWebGPURenderer,
  zoomAt,
  type Camera,
  type Renderer,
} from '@figma-canvas/renderer'
import { scene } from '../state/scene'
import { frameStats } from '../state/stats'
import { useUI } from '../state/uiStore'
import { createPointerInput } from '../input/pointerInput'
import styles from './CanvasHost.module.css'

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
        renderer.render({ camera: cameraRef.current, selection: useUI.getState().selection })
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

    const observer = new ResizeObserver(resize)
    const unsubscribe = scene.subscribe(draw)
    // Selection is drawn but is not in the document, so it needs its own redraw trigger.
    const unsubscribeSelection = useUI.subscribe((state, previous) => {
      if (state.selection !== previous.selection) draw()
    })
    canvas.addEventListener('wheel', onWheel, { passive: false })

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
      getSelection: () => useUI.getState().selection,
      setSelection: (ids) => useUI.getState().setSelection(ids),
      toggleInSelection: (id) => useUI.getState().toggleInSelection(id),
      requestDraw: draw,
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

    void createWebGPURenderer({ canvas, document: scene }, { onLost: setError })
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
      observer.disconnect()
      unsubscribe()
      unsubscribeSelection()
      disposeInput()
      canvas.removeEventListener('wheel', onWheel)
      media?.removeEventListener('change', onPixelRatioChange)
      renderer?.destroy()
      renderer = null
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} />
      {error && <p className={styles.error}>{error}</p>}
    </>
  )
}
