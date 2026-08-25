import {
  parseDocument,
  serializeDocument,
  type SceneDocument,
  type SerializedDocument,
} from '@canvas/document'
import { startDebouncedSave } from './localStorage'

const KEY = 'figma-canvas:document'
/** Where a save that will not parse gets moved, rather than being overwritten and lost. */
const QUARANTINE_KEY = 'figma-canvas:document.unreadable'

/** Long enough that a drag writes once at the end, short enough to survive a tab close. */
const AUTOSAVE_DELAY = 600

export function toJSON(document: SceneDocument): string {
  return JSON.stringify(serializeDocument(document))
}

export function fromJSON(text: string): SerializedDocument {
  return parseDocument(JSON.parse(text) as unknown)
}

/**
 * Reads the saved document, or returns null when there is nothing to read.
 *
 * A save that will not parse is moved aside rather than deleted, and the reason is logged.
 * Falling back to a blank document silently would look identical to losing someone's work.
 */
export function readSaved(): SerializedDocument | null {
  let text: string | null = null
  try {
    text = window.localStorage.getItem(KEY)
  } catch (cause) {
    console.warn('Local storage is unavailable, so this session will not persist.', cause)
    return null
  }
  if (!text) return null

  try {
    return fromJSON(text)
  } catch (cause) {
    console.error('The saved document could not be read, so the editor started fresh.', cause)
    try {
      window.localStorage.setItem(QUARANTINE_KEY, text)
      window.localStorage.removeItem(KEY)
    } catch {
      // Quarantining is a courtesy. If it fails there is nothing further worth doing.
    }
    return null
  }
}

export function save(document: SceneDocument): void {
  try {
    window.localStorage.setItem(KEY, toJSON(document))
  } catch (cause) {
    // Quota exceeded, or private mode on some browsers. Worth saying once, not every edit.
    console.warn('Could not save the document.', cause)
  }
}

/**
 * Saves shortly after edits stop. A drag emits a change per frame, and writing the whole
 * document sixty times a second would stall the gesture it is trying to record.
 */
export function startAutosave(document: SceneDocument): () => void {
  return startDebouncedSave(
    (onChange) => document.subscribe(onChange),
    () => save(document),
    AUTOSAVE_DELAY,
  )
}
