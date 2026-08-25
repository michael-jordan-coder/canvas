import { useRef, useState, type ReactElement } from 'react'
import { InvalidDocumentError } from '@canvas/document'
import { scene } from '../state/scene'
import { rerunAllCodeNodes } from '../state/code'
import { fromJSON, toJSON } from '../state/persistence'
import { useUI } from '../state/uiStore'
import { DownloadIcon, UploadIcon } from './icons'
import styles from './FileActions.module.css'

export function FileActions(): ReactElement {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const exportDocument = (): void => {
    const blob = new Blob([toJSON(scene)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'canvas.json'
    link.click()
    // The object URL pins the blob in memory until it is released.
    URL.revokeObjectURL(url)
  }

  const importDocument = async (file: File): Promise<void> => {
    try {
      const parsed = fromJSON(await file.text())
      scene.load(parsed.root, parsed.nodes)
      // The file carries no generated children, only sources. A file is untrusted input, so
      // rerunAllCodeNodes runs only sources this session already trusts and leaves the rest
      // showing their source until the person runs them; opening a file is not an edit either,
      // which it also accounts for.
      rerunAllCodeNodes()
      useUI.getState().clearSelection()
      setError(null)
    } catch (cause) {
      // The one place a bad file reaches a person, so it says what was wrong with it.
      setError(
        cause instanceof InvalidDocumentError
          ? cause.message
          : `${file.name} is not readable as JSON`,
      )
    }
  }

  return (
    <div className={styles.actions}>
      {error && (
        <span className={styles.error} role="alert" aria-live="assertive">
          {error}
        </span>
      )}
      <button type="button" className={styles.action} aria-label="Export" onClick={exportDocument}>
        <DownloadIcon />
      </button>
      <button
        type="button"
        className={styles.action}
        aria-label="Import"
        onClick={() => fileRef.current?.click()}
      >
        <UploadIcon />
      </button>
      <input
        ref={fileRef}
        className={styles.file}
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Reset first, so choosing the same file twice in a row still fires a change.
          event.target.value = ''
          if (file) void importDocument(file)
        }}
      />
    </div>
  )
}
