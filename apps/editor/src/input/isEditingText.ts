/**
 * A shortcut must not fire while someone is typing a value into a text field. A select
 * counts: its arrows change the option and its letters are typeahead, and the global
 * listener cancelling those would edit the document instead.
 */
export function isEditingText(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  return target instanceof HTMLElement && target.isContentEditable
}
