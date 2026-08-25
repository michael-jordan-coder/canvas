import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { readStored, writeStored } from '../state/localStorage'
import { CARD_NUDGE, clampCardSize } from './cardSize'
import styles from './CornerGrip.module.css'

/**
 * The grab corner of a floating card.
 *
 * `PanelResizer`'s idioms, not its code: that one is a single axis on a docked grid column,
 * and widening it to two axes and a free corner would double every branch it has for its one
 * caller. What is shared is the shape of the thing, and it is the shape that matters here:
 * the live numbers stay in refs so a drag is not a React render per frame, the restore is a
 * layout effect so nothing is drawn at the wrong size first, the value is written on release
 * rather than per move, a double click returns the stylesheet default, and the arrow keys
 * nudge with the event stopped so the same press does not also move the selection.
 *
 * The card is anchored to the bottom right of the viewport, so this sits at its top left and
 * dragging away from the anchor grows it. The size lands on two custom properties on the
 * root element rather than on the card: the card unmounts entirely when the panel closes, so
 * a property set on it would be gone on every reopen, while the root outlives it and the
 * card is the right size in its first frame.
 */

interface CornerGripProps {
  /** The card being sized. Its anchored edges are what a drag measures from. */
  targetRef: RefObject<HTMLElement | null>
  widthVar: string
  heightVar: string
  widthKey: string
  heightKey: string
  label: string
  /** Called whenever the size changed, for anything that has to follow it. */
  onResize?: () => void
}

function apply(cssVar: string, value: number | null): void {
  if (value === null) {
    document.documentElement.style.removeProperty(cssVar)
  } else {
    document.documentElement.style.setProperty(cssVar, `${value}px`)
  }
}

export function CornerGrip({
  targetRef,
  widthVar,
  heightVar,
  widthKey,
  heightKey,
  label,
  onResize,
}: CornerGripProps): ReactElement {
  const dragging = useRef<number | null>(null)
  /** The card's anchored edges, read once per drag: they are what the size is measured from. */
  const anchor = useRef<{ right: number; bottom: number } | null>(null)
  const [active, setActive] = useState(false)

  useLayoutEffect(() => {
    const width = Number.parseFloat(readStored(widthKey) ?? '')
    const height = Number.parseFloat(readStored(heightKey) ?? '')
    if (!Number.isFinite(width) || !Number.isFinite(height)) return
    const size = clampCardSize({ width, height })
    apply(widthVar, size.width)
    apply(heightVar, size.height)
  }, [widthVar, heightVar, widthKey, heightKey])

  const setSize = (width: number, height: number): void => {
    const size = clampCardSize({ width, height })
    apply(widthVar, size.width)
    apply(heightVar, size.height)
    onResize?.()
  }

  const persist = (): void => {
    const box = targetRef.current?.getBoundingClientRect()
    if (!box) return
    writeStored(widthKey, Math.round(box.width).toString())
    writeStored(heightKey, Math.round(box.height).toString())
  }

  const release = (pointerId: number): void => {
    if (dragging.current !== pointerId) return
    dragging.current = null
    anchor.current = null
    setActive(false)
    persist()
  }

  /** Positive grows. The current size comes from the card itself, so an untouched default
   *  needs no constant here to restate what the stylesheet already says. */
  const nudge = (dx: number, dy: number): void => {
    const box = targetRef.current?.getBoundingClientRect()
    if (!box) return
    setSize(box.width + dx, box.height + dy)
    persist()
  }

  return (
    <button
      type="button"
      className={styles.grip}
      data-active={active ? '' : undefined}
      aria-label={label}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // Without this the drag also starts a native selection across the transcript.
        event.preventDefault()
        const box = targetRef.current?.getBoundingClientRect()
        if (!box) return
        anchor.current = { right: box.right, bottom: box.bottom }
        dragging.current = event.pointerId
        setActive(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (dragging.current !== event.pointerId || !anchor.current) return
        setSize(anchor.current.right - event.clientX, anchor.current.bottom - event.clientY)
      }}
      onPointerUp={(event) => release(event.pointerId)}
      onPointerCancel={(event) => release(event.pointerId)}
      onDoubleClick={() => {
        apply(widthVar, null)
        apply(heightVar, null)
        writeStored(widthKey, null)
        writeStored(heightKey, null)
        onResize?.()
      }}
      onKeyDown={(event) => {
        // The arrows pointing away from the anchored corner grow the card, which is the
        // direction the drag moves in too.
        const steps: Record<string, [number, number]> = {
          ArrowLeft: [CARD_NUDGE, 0],
          ArrowRight: [-CARD_NUDGE, 0],
          ArrowUp: [0, CARD_NUDGE],
          ArrowDown: [0, -CARD_NUDGE],
        }
        const step = steps[event.key]
        if (!step) return
        // Consumed here, or the same keystroke reaches the window listener and nudges
        // whatever is selected on the canvas one step per repeat.
        event.preventDefault()
        event.stopPropagation()
        nudge(step[0], step[1])
      }}
    />
  )
}
