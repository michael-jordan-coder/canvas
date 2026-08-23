import { useRef, type ReactElement } from 'react'
import styles from './CodeArea.module.css'

interface CodeAreaProps {
  value: string
  label: string
  readOnly?: boolean
  onChange?: (value: string) => void
  /** Leaving. Handled here because this component stops keys reaching anything above it. */
  onEscape?: () => void
  /**
   * Cmd or Ctrl S. Committing is a key rather than a button and deliberately not a blur: this
   * writes to the repo, and clicking away from a file is not a decision to save it.
   */
  onSave?: () => void
}

/** Two spaces, matching everything else in this repo. */
const INDENT = '  '

/**
 * A plain text surface for code. See the stylesheet for why it is a textarea.
 *
 * The only key it handles itself is Tab, which would otherwise move focus out of the field:
 * in a code surface that is never what was meant. Everything else is left to the platform,
 * including undo, because the browser's own textarea history is better than anything worth
 * writing here and the window level shortcuts already stand down while this has focus.
 */
export function CodeArea({
  value,
  label,
  readOnly,
  onChange,
  onEscape,
  onSave,
}: CodeAreaProps): ReactElement {
  const field = useRef<HTMLTextAreaElement>(null)

  const insertIndent = (): void => {
    const element = field.current
    if (!element || !onChange) return
    const { selectionStart, selectionEnd } = element
    const next = `${value.slice(0, selectionStart)}${INDENT}${value.slice(selectionEnd)}`
    onChange(next)
    // Restored after React has written the new value, so the caret lands after the indent
    // rather than jumping to the end of the field.
    window.requestAnimationFrame(() => {
      const at = selectionStart + INDENT.length
      element.setSelectionRange(at, at)
    })
  }

  return (
    <textarea
      ref={field}
      className={styles.area}
      aria-label={label}
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault()
          insertIndent()
        }
        if ((event.key === 's' || event.key === 'S') && (event.metaKey || event.ctrlKey) && onSave) {
          // The browser would offer to save the page, which is never what this means.
          event.preventDefault()
          onSave()
        }
        if (event.key === 'Escape' && onEscape) {
          event.preventDefault()
          onEscape()
        }
        /*
         * Nothing typed in here may reach the canvas. The window listeners already bail on
         * `isEditingText`, but stopping the event here is what the other fields in this app do
         * and it also covers React level handlers between here and the root.
         */
        event.stopPropagation()
      }}
    />
  )
}
