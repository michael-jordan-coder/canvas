import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import styles from './PanelResizer.module.css'

/** How wide a panel is allowed to be dragged, and where a double click puts it back. */
const PANEL_MIN_WIDTH = 240
const PANEL_MAX_WIDTH = 480

const clampWidth = (width: number): number =>
  Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width))

/**
 * Storage can throw rather than merely fail: Safari private mode and storage-blocked
 * embeds raise on access, the case `state/persistence.ts` already guards against. A panel
 * width is not worth a blank editor, so these degrade to "this session does not persist".
 */
const readStored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStored = (key: string, value: string | null): void => {
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch {
    // Quota exceeded, or storage blocked. The width simply resets next load.
  }
}

interface PanelResizerProps {
  /** Which screen edge the panel is docked to. The grab edge sits on the opposite side. */
  side: 'left' | 'right'
  /** The root custom property the app grid reads, e.g. `--panel-width-left`. */
  cssVar: string
  /** Where the width survives a reload. */
  storageKey: string
  label: string
}

/**
 * The width lives on a root custom property rather than a style prop, the same shape the
 * scrub cursor takes: the stylesheet stays the only place a component's CSS is written,
 * and the app grid reads the token without knowing the panel resizes at all.
 */
const applyWidth = (cssVar: string, width: number | null): void => {
  if (width === null) {
    document.documentElement.style.removeProperty(cssVar)
  } else {
    document.documentElement.style.setProperty(cssVar, `${width}px`)
  }
}

/**
 * The grab edge along one side of a docked panel. UI chrome, not document state, so it
 * never goes near the scene or its history: the width is remembered in localStorage on
 * release and put back on mount. A double click returns the default, which is also what
 * clears the store.
 */
export function PanelResizer({ side, cssVar, storageKey, label }: PanelResizerProps): ReactElement {
  const dragging = useRef<number | null>(null)
  // The number is the source of truth and the custom property is only ever written, so
  // nothing has to parse a width back out of the DOM. Null means "the stylesheet default",
  // whatever the token happens to be.
  const width = useRef<number | null>(null)
  const [active, setActive] = useState(false)

  // Layout effect, not effect: the grid resolves the token's default on first layout, and
  // restoring the saved width after paint would show a one-frame jump plus an extra canvas
  // surface resize on every load.
  useLayoutEffect(() => {
    const saved = Number.parseFloat(readStored(storageKey) ?? '')
    if (Number.isFinite(saved)) {
      width.current = clampWidth(saved)
      applyWidth(cssVar, width.current)
    }
  }, [cssVar, storageKey])

  const setWidth = (next: number | null): void => {
    width.current = next
    applyWidth(cssVar, next)
  }

  const persist = (): void => {
    if (width.current !== null) writeStored(storageKey, width.current.toString())
  }

  const release = (pointerId: number): void => {
    if (dragging.current !== pointerId) return
    dragging.current = null
    setActive(false)
    persist()
  }

  /** Positive grows the panel, whichever side it hangs from. */
  const nudge = (delta: number): void => {
    // An untouched panel sits at the stylesheet default, which only the computed style
    // knows; falling back to a constant here would double the token in TypeScript.
    const current =
      width.current ??
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar))
    setWidth(clampWidth((Number.isFinite(current) ? current : PANEL_MIN_WIDTH) + delta))
    persist()
  }

  return (
    <div
      className={side === 'left' ? `${styles.resizer} ${styles.onRight}` : `${styles.resizer} ${styles.onLeft}`}
      data-active={active ? '' : undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // Without this the drag also starts a native text selection across the panel.
        event.preventDefault()
        dragging.current = event.pointerId
        setActive(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (dragging.current !== event.pointerId) return
        const next = side === 'left' ? event.clientX : window.innerWidth - event.clientX
        setWidth(clampWidth(next))
      }}
      onPointerUp={(event) => release(event.pointerId)}
      onPointerCancel={(event) => release(event.pointerId)}
      onDoubleClick={() => {
        setWidth(null)
        writeStored(storageKey, null)
      }}
      onKeyDown={(event) => {
        // The arrow that points toward the canvas grows the panel into it.
        const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
        const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
        if (event.key !== grow && event.key !== shrink) return
        // Consumed here, or the same keystroke reaches the window listener and nudges
        // whatever is selected on the canvas one step per repeat.
        event.preventDefault()
        event.stopPropagation()
        nudge(event.key === grow ? 16 : -16)
      }}
    />
  )
}
