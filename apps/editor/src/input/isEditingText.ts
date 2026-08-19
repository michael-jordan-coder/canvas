/** A shortcut must not fire while someone is typing a value into a text field. */
export function isEditingText(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLElement && target.isContentEditable
}
