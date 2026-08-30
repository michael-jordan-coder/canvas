import { useEffect, useRef, type ReactElement } from 'react'
import { selectionBox } from '@canvas/renderer'
import { scene, useNode } from '../state/scene'
import { useUI } from '../state/uiStore'
import { beginPlay, endPlay } from '../state/code'
import {
  canvasView,
  requestCanvasView,
  subscribeCanvasView,
  type CanvasView,
} from '../state/canvasView'
import { PlayIcon, StopIcon } from './icons'
import styles from './CodePlayButton.module.css'

/** Gap between the top of the frame and the button, in CSS pixels. */
const GAP = 8

/**
 * Play, sitting on the canvas above the code node it runs, the way the run control belongs
 * to the thing it runs rather than to a panel on the far side of the window.
 *
 * The only DOM that tracks a world position, and it moves itself: the camera arrives once
 * per drawn frame through `canvasView` and the placement is written as two custom properties
 * on the element. React state for a value that changes at pointer rate would put a render
 * between the pointer and the pixels on every frame of a pan, and the panel and the layers
 * tree would re-render with it.
 */
export function CodePlayButton(): ReactElement | null {
  const selection = useUI((state) => state.selection)
  const play = useUI((state) => state.play)
  const editing = useUI((state) => state.editing)
  const only = selection.length === 1 ? selection[0] : undefined
  const selected = useNode(only)
  // The playing node wins over the selection: play routes pointer events into the node, so
  // the selection may well have been cleared while it runs, and Stop has to stay reachable.
  const target = play ?? (selected?.type === 'code' ? selected.id : null)

  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!target) return
    const element = ref.current
    if (!element) return

    const place = (view: CanvasView): void => {
      const box = selectionBox(scene, [target], view.camera, view.viewport)
      if (!box) return
      // The unrotated top left of the box. A turned code node keeps its button upright and
      // above the box's bounds, since a control is read by the person, not by the canvas.
      element.style.setProperty('--x', `${Math.round(box.rect.x)}px`)
      element.style.setProperty('--y', `${Math.round(box.rect.y) - GAP}px`)
      // Until this has run the button has no place to be, and an unplaced absolute element
      // sits at the top left of the viewport, which is over the toolbar rather than on the
      // canvas. It stays hidden rather than appearing there for a frame.
      element.dataset.placed = ''
    }

    const unsubscribe = subscribeCanvasView(place)
    const view = canvasView()
    // Nothing may have moved since the last frame was drawn, in which case there is no
    // frame coming and the subscription alone would never fire.
    if (view) place(view)
    else requestCanvasView()
    return unsubscribe
  }, [target])

  if (!target || editing) return null

  const playing = play === target

  return (
    <button
      ref={ref}
      type="button"
      className={styles.button}
      data-playing={playing ? '' : undefined}
      aria-label={playing ? 'Stop the prototype' : 'Play the prototype'}
      aria-pressed={playing}
      onClick={() => (playing ? endPlay() : beginPlay(target))}
    >
      {playing ? <StopIcon size={12} /> : <PlayIcon size={12} />}
      {playing ? 'Stop' : 'Play'}
    </button>
  )
}
