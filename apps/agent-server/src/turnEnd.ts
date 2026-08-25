/**
 * How a turn that did not simply finish is described to the person.
 *
 * The SDK reports an unsuccessful turn as an enum: `error_max_turns`,
 * `error_during_execution`. Those are the right words for a log and the wrong ones for a
 * chat window, and passing them through was the only thing the editor had to show. Kept in
 * its own module because importing `index.ts` binds the port, so nothing there is testable.
 */
export function describeResult(subtype: string): string {
  switch (subtype) {
    case 'error_max_turns':
      return 'The assistant reached its limit of steps for one turn.'
    case 'error_during_execution':
      return 'The assistant hit an error partway through.'
    default:
      // The subtype is kept, because an unmapped one is the only clue about what happened.
      return `The assistant stopped before finishing (${subtype}).`
  }
}
