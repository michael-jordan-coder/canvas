import { useEffect, useRef, useState, type ReactElement } from 'react'
import { fromHex, parseHex, toHex, type RGBA } from '@figma-canvas/document'
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
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  // Mirrors `hexDraft` so a commit can clear it synchronously. See `commitHex`.
  const draftRef = useRef<string | null>(null)

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

  // A row removed from a paint stack while its picker is open never blurs, and a group left
  // open silently swallows every later edit in the session. Same net `NumberField` keeps
  // under a scrub whose node is deselected out from under it.
  useEffect(
    () => () => {
      if (grouped.current) scene.endHistoryGroup()
    },
    [],
  )

  const editHex = (value: string | null): void => {
    draftRef.current = value
    setHexDraft(value)
  }

  /**
   * A single valid hex commit is one discrete change, unlike the swatch's continuous drag
   * session above, so it needs no history group of its own.
   *
   * The draft is cleared through the ref before anything else, because committing on Enter
   * calls `blur()`, and that dispatches focusout synchronously: `onBlur` would re-enter this
   * with the state from the current render, where `hexDraft` is still set, and commit the same
   * colour a second time. Two `scene.update` calls means two undo steps, the second a no-op,
   * so one Enter would need two undos to walk back.
   */
  const commitHex = (): void => {
    const draft = draftRef.current
    if (draft === null) return
    editHex(null)
    const parsed = parseHex(draft)
    if (parsed) onChange({ ...parsed.color, a: color.a })
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
      <input
        className={styles.hex}
        type="text"
        aria-label={`${label} hex value`}
        spellCheck={false}
        value={hexDraft ?? toHex(color).slice(1).toUpperCase()}
        onChange={(event) => editHex(event.target.value)}
        onBlur={commitHex}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitHex()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            editHex(null)
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
