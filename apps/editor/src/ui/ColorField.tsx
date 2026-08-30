import { useRef, useState, type ReactElement } from 'react'
import { parseHex, toHex, type RGBA } from '@canvas/document'
import { ColorPicker } from './ColorPicker'
import styles from './ColorField.module.css'

interface ColorFieldProps {
  label: string
  color: RGBA
  onChange: (color: RGBA) => void
}

/**
 * The swatch is the control, not a preview of one: clicking it opens our own picker rather
 * than the browser's, so a fill, a stroke, a shadow and a gradient stop all pick colour the
 * same way the rest of the canvas draws, in SVG with the colour on a presentation attribute.
 * The picker keeps its own history group per drag; this field only ever commits the hex text
 * as one discrete edit.
 */
export function ColorField({ label, color, onChange }: ColorFieldProps): ReactElement {
  const [open, setOpen] = useState(false)
  const swatchRef = useRef<HTMLButtonElement>(null)
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  // Mirrors `hexDraft` so a commit can clear it synchronously. See `commitHex`.
  const draftRef = useRef<string | null>(null)

  const editHex = (value: string | null): void => {
    draftRef.current = value
    setHexDraft(value)
  }

  /**
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
    // The picker has no hex field of its own, so whatever alpha the colour already had is
    // kept: typing a hex value changes the colour, not how much of it shows through.
    if (parsed) onChange({ ...parsed.color, a: color.a })
  }

  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <button
        ref={swatchRef}
        type="button"
        className={styles.swatch}
        aria-label={`${label} colour`}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
          <rect className={styles.swatchRect} x="0.5" y="0.5" width="13" height="13" rx="2" fill={toHex(color)} />
        </svg>
      </button>
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
      {open && swatchRef.current && (
        <ColorPicker
          label={label}
          color={color}
          anchor={swatchRef.current}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
