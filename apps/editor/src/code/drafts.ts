/**
 * Unsaved source edits, parked while the panel is looking at something else.
 *
 * Selecting anything other than the component leaves its file, which is what keeps the panel
 * about the selection with no mode indicator. Without this that rule would also throw away
 * whatever had been typed, and it would do it on an ordinary click on the canvas rather than
 * on any gesture that means discard.
 *
 * So a draft outlives the panel. It is a module map rather than store state because nothing
 * else reads it and a keystroke should not wake a subscriber, and it is not in the document
 * because a file is not part of the scene: it must not be in a save, a history step or
 * anything a collaborator would receive.
 *
 * The base travels with the draft, because it is what the edit was made against: parking and
 * coming back has to leave a stale save a refusal rather than an overwrite, exactly as staying
 * would have.
 */

export interface DraftBase {
  text: string
  mtimeMs: number
}

export interface Draft {
  /** What is in the field. Only stored when it differs from `base.text`. */
  text: string
  base: DraftBase
}

const drafts = new Map<string, Draft>()

export function draftFor(file: string): Draft | undefined {
  return drafts.get(file)
}

export function parkDraft(file: string, draft: Draft): void {
  drafts.set(file, draft)
}

/** After a save, or after discarding. The file speaks for itself again. */
export function clearDraft(file: string): void {
  drafts.delete(file)
}
