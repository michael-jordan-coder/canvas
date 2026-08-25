/**
 * The one binding that opens the assistant, in a module of its own so the panel and the
 * window handler read the same constant. They both need it: pressed on the canvas it opens
 * the card and focuses the composer, and pressed inside the composer it closes it again,
 * which is handled there because `keyboardInput`'s first line hands every keystroke in a
 * text field back to the field, and that rule is worth more than this shortcut.
 *
 * Cmd+K rather than the obvious Cmd+H, which never reaches a page on macOS: the system takes
 * it to hide the application. It is also what every other assistant in a browser binds, and
 * cancelling it with `preventDefault` is reliable.
 */
type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

export const ASSISTANT_KEY = 'k'

export function isAssistantShortcut(event: KeyLike): boolean {
  if (event.altKey || event.shiftKey) return false
  if (!event.metaKey && !event.ctrlKey) return false
  return event.key.toLowerCase() === ASSISTANT_KEY
}
