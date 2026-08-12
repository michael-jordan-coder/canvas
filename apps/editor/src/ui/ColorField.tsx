import { useRef, type ReactElement } from 'react'
import { fromHex, toHex, type RGBA } from '@figma-canvas/document'
import { scene } from '../state/scene'
import styles from './ColorField.module.css'

interface ColorFieldProps {
  label: string
  color: RGBA
  onChange: (color: RGBA) => void
}

/**
 * The swatch is the control, not a preview of one.
 *
 * A native colour input fires on every movement inside the picker, so the whole session is
 * folded into one history group and closed on blur, which is the same shape a canvas drag
 * uses. Without that, opening the picker once would leave a hundred undo steps behind.
 */
export function ColorField({ label, color, onChange }: ColorFieldProps): ReactElement {
  const grouped = useRef(false)

  const pick = (hex: string): void => {
    if (!grouped.current) {
      scene.beginHistoryGroup()
      grouped.current = true
    }
    // The picker has no alpha channel, so whatever the paint already had is kept.
    onChange({ ...fromHex(hex).color, a: color.a })
  }

  const end = (): void => {
    if (!grouped.current) return
    grouped.current = false
    scene.endHistoryGroup()
  }

  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.swatch}
        type="color"
        aria-label={`${label} colour`}
        value={toHex(color)}
        onChange={(event) => pick(event.target.value)}
        onBlur={end}
      />
      <span className={styles.hex}>{toHex(color).slice(1).toUpperCase()}</span>
    </div>
  )
}
