/**
 * The editor's shared persistence plumbing: guarded storage access, and the debounce that
 * every autosave here is written on.
 *
 * Storage can throw rather than merely fail: Safari private mode and storage-blocked embeds
 * raise on access, the case `state/persistence.ts` already guards against. Nothing that goes
 * through here is worth a blank editor, so all of it degrades to "this session does not
 * persist".
 *
 * Shared because two components remember a dimension this way, and a second private copy of
 * the try/catch is a second place for someone to forget it.
 */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch {
    // Quota exceeded, or storage blocked. The value simply resets next load.
  }
}


/**
 * Saves shortly after changes stop, and never loses a pending write to a tab close.
 *
 * Both autosaves in the editor want the same three things and want them to agree: a
 * debounce, because a drag emits a change per frame and a keystroke per character; a
 * `pagehide` flush, because a tab closed mid-debounce would otherwise drop the last edit;
 * and a disposer that unwinds all three. Written twice they drift, and the half that drifts
 * is the tab-close path, which is the half nobody notices is broken.
 *
 * `subscribe` returns its own unsubscribe, so the caller decides what counts as a change:
 * the document notifies on every version, the transcript only when its items differ.
 */
export function startDebouncedSave(
  subscribe: (onChange: () => void) => () => void,
  save: () => void,
  delay: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    save()
  }

  const unsubscribe = subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      save()
    }, delay)
  })

  window.addEventListener('pagehide', flush)

  return () => {
    clearTimeout(timer)
    unsubscribe()
    window.removeEventListener('pagehide', flush)
  }
}
