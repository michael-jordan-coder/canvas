/**
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
