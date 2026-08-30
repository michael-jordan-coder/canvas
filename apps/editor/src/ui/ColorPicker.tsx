import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { hsvToRgb, rgbToHsv, toHex, type HSV, type RGBA } from '@canvas/document'
import { scene } from '../state/scene'
import styles from './ColorPicker.module.css'

const SV_WIDTH = 200
const SV_HEIGHT = 140
const TRACK_WIDTH = 200
const TRACK_HEIGHT = 12
const POPOVER_MARGIN = 8

const HUE_STOPS = [
  [0, '#f00'],
  [1 / 6, '#ff0'],
  [2 / 6, '#0f0'],
  [3 / 6, '#0ff'],
  [4 / 6, '#00f'],
  [5 / 6, '#f0f'],
  [1, '#f00'],
] as const

const colorsEqual = (a: RGBA, b: RGBA): boolean =>
  Math.abs(a.r - b.r) < 0.001 &&
  Math.abs(a.g - b.g) < 0.001 &&
  Math.abs(a.b - b.b) < 0.001 &&
  Math.abs(a.a - b.a) < 0.001

/**
 * A drag along one SVG element's own box, reported as a 0..1 fraction on each axis. Every
 * track in the picker shares this: pointer capture so the drag survives leaving the element,
 * one history group per press-to-release the same shape the gradient ramp's stop drag uses,
 * and a cleanup effect that closes an abandoned group if the row it belongs to is removed
 * mid drag.
 */
function useTrackDrag<E extends SVGSVGElement>(
  onMove: (fraction: { x: number; y: number }) => void,
) {
  const ref = useRef<E>(null)
  const grouped = useRef(false)

  const move = (clientX: number, clientY: number): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    onMove({
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    })
  }

  useEffect(() => () => {
    if (grouped.current) scene.endHistoryGroup()
  }, [])

  return {
    ref,
    onPointerDown: (event: ReactPointerEvent<E>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      if (!grouped.current) {
        scene.beginHistoryGroup()
        grouped.current = true
      }
      move(event.clientX, event.clientY)
    },
    onPointerMove: (event: ReactPointerEvent<E>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      move(event.clientX, event.clientY)
    },
    onPointerUp: (event: ReactPointerEvent<E>) => {
      if (!grouped.current) return
      grouped.current = false
      scene.endHistoryGroup()
      event.currentTarget.releasePointerCapture(event.pointerId)
    },
  }
}

function SaturationValueField({
  hsv,
  label,
  onChange,
}: {
  hsv: HSV
  label: string
  onChange: (s: number, v: number) => void
}): ReactElement {
  const id = useId()
  const drag = useTrackDrag<SVGSVGElement>(({ x, y }) => onChange(x, 1 - y))
  const hueHex = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }))

  return (
    <svg
      {...drag}
      className={styles.field}
      viewBox={`0 0 ${SV_WIDTH} ${SV_HEIGHT}`}
      aria-label={`${label} saturation and value`}
    >
      <defs>
        {/* White fading right, black fading up: the two are independent so one pair of
            static gradients composes over any hue rather than needing one per colour. */}
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-v`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#000" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={SV_WIDTH} height={SV_HEIGHT} rx={4} fill={hueHex} />
      <rect width={SV_WIDTH} height={SV_HEIGHT} rx={4} fill={`url(#${id}-s)`} />
      <rect width={SV_WIDTH} height={SV_HEIGHT} rx={4} fill={`url(#${id}-v)`} />
      <circle className={styles.handle} cx={hsv.s * SV_WIDTH} cy={(1 - hsv.v) * SV_HEIGHT} r={6} />
    </svg>
  )
}

function HueSlider({
  hue,
  label,
  onChange,
}: {
  hue: number
  label: string
  onChange: (hue: number) => void
}): ReactElement {
  const id = useId()
  const drag = useTrackDrag<SVGSVGElement>(({ x }) => onChange(x * 360))

  return (
    <svg
      {...drag}
      className={styles.track}
      viewBox={`0 0 ${TRACK_WIDTH} ${TRACK_HEIGHT}`}
      aria-label={`${label} hue`}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          {HUE_STOPS.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <rect
        className={styles.trackBody}
        width={TRACK_WIDTH}
        height={TRACK_HEIGHT}
        rx={TRACK_HEIGHT / 2}
        fill={`url(#${id})`}
      />
      <circle className={styles.handle} cx={(hue / 360) * TRACK_WIDTH} cy={TRACK_HEIGHT / 2} r={7} />
    </svg>
  )
}

/**
 * The alpha track's own colour is the current hue and saturation at full opacity, so
 * dragging it previews exactly what committing that alpha would look like rather than a
 * generic black to white fade. The chequer is the page showing through, drawn under the
 * track by `.alphaTrack`'s own CSS background the same way the gradient ramp's is.
 */
function AlphaSlider({
  color,
  label,
  onChange,
}: {
  color: RGBA
  label: string
  onChange: (alpha: number) => void
}): ReactElement {
  const id = useId()
  const drag = useTrackDrag<SVGSVGElement>(({ x }) => onChange(x))
  const hex = toHex(color)

  return (
    <svg
      {...drag}
      className={`${styles.track} ${styles.alphaTrack}`}
      viewBox={`0 0 ${TRACK_WIDTH} ${TRACK_HEIGHT}`}
      aria-label={`${label} alpha`}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={hex} stopOpacity="0" />
          <stop offset="1" stopColor={hex} stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect
        className={styles.trackBody}
        width={TRACK_WIDTH}
        height={TRACK_HEIGHT}
        rx={TRACK_HEIGHT / 2}
        fill={`url(#${id})`}
      />
      <circle className={styles.handle} cx={color.a * TRACK_WIDTH} cy={TRACK_HEIGHT / 2} r={7} />
    </svg>
  )
}

interface ColorPickerProps {
  label: string
  color: RGBA
  anchor: HTMLElement
  onChange: (color: RGBA) => void
  onClose: () => void
}

/**
 * The saturation/value square, a hue ring's worth of track and an alpha track, replacing
 * the browser's own colour dialog with one drawn the way the rest of the canvas is: SVG,
 * with every dynamic colour on a presentation attribute rather than a style prop, the same
 * rule the gradient ramp and the selection colours swatch already follow.
 *
 * Hue and saturation live in the picker's own state rather than being re-derived from
 * `color` on every render, because RGB has no hue to read back once value or saturation
 * reaches zero: dragging value down to black and back up would otherwise forget whatever
 * hue the pointer had chosen and land back on red. `color` only overwrites them when it
 * changed for a reason other than this picker's own last emit, such as the row's hex field
 * being typed into while the popover is open.
 */
export function ColorPicker({ label, color, anchor, onChange, onClose }: ColorPickerProps): ReactElement {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [hsv, setHsv] = useState(() => rgbToHsv(color))
  const lastEmitted = useRef(color)

  useEffect(() => {
    if (colorsEqual(color, lastEmitted.current)) return
    lastEmitted.current = color
    setHsv((current) => rgbToHsv(color, current.h))
  }, [color])

  const commit = (rgb: RGBA): void => {
    lastEmitted.current = rgb
    onChange(rgb)
  }

  useLayoutEffect(() => {
    const popover = popoverRef.current
    if (!popover) return
    const anchorRect = anchor.getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = popover
    let x = anchorRect.left
    let y = anchorRect.bottom + POPOVER_MARGIN
    if (x + width > window.innerWidth - POPOVER_MARGIN) x = window.innerWidth - POPOVER_MARGIN - width
    x = Math.max(POPOVER_MARGIN, x)
    if (y + height > window.innerHeight - POPOVER_MARGIN) y = anchorRect.top - POPOVER_MARGIN - height
    popover.style.setProperty('--x', `${Math.round(x)}px`)
    popover.style.setProperty('--y', `${Math.round(y)}px`)
    popover.dataset['placed'] = ''
  }, [anchor])

  // Closes on a click outside either surface, and on Escape wherever focus is: a drag on a
  // track never focuses anything, the same reason NumberField's scrub listens in capture
  // phase. The canvas's own Escape (clear selection) must not also fire, hence capture here.
  useEffect(() => {
    const onPointerDownOutside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDownOutside, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDownOutside, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchor, onClose])

  return (
    <div ref={popoverRef} className={styles.popover} role="dialog" aria-label={`${label} colour picker`}>
      <SaturationValueField
        hsv={hsv}
        label={label}
        onChange={(s, v) => {
          const next = { ...hsv, s, v }
          setHsv(next)
          commit(hsvToRgb(next, color.a))
        }}
      />
      <HueSlider
        hue={hsv.h}
        label={label}
        onChange={(h) => {
          const next = { ...hsv, h }
          setHsv(next)
          commit(hsvToRgb(next, color.a))
        }}
      />
      <AlphaSlider color={color} label={label} onChange={(a) => commit({ ...color, a })} />
    </div>
  )
}
