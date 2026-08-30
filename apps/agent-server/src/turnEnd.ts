import type { TurnEndReason } from './protocol.ts'

/**
 * The SDK's result subtype as a reason the protocol names.
 *
 * The SDK reports an unsuccessful turn as an enum: `error_max_turns`,
 * `error_during_execution`. Those are the right words for a log and the wrong ones for a
 * chat window, but the mapping is still the server's job, because the subtype only exists
 * here. What the person reads is the editor's, beside the rest of the assistant's copy.
 *
 * Kept in its own module because importing `index.ts` binds the port, so nothing there is
 * testable.
 */
export function resultReason(subtype: string): { reason: TurnEndReason; detail?: string } {
  switch (subtype) {
    case 'error_max_turns':
      return { reason: 'max_turns' }
    case 'error_during_execution':
      return { reason: 'error' }
    default:
      // The subtype is kept, because an unmapped one is the only clue about what happened.
      return { reason: 'error', detail: subtype }
  }
}

/**
 * The same mapping for a turn the SDK ends by throwing rather than by yielding a result.
 *
 * The step cap arrives both ways. Usually it is a `result` with subtype `error_max_turns`,
 * which `resultReason` names; sometimes the query throws instead, and then the only thing
 * carrying the distinction is the message. Without this the person reads "The assistant hit
 * an error partway through (Claude Code returned an error result: Reached maximum number of
 * turns (50))", which is the raw sentence the panel's whole reason enum exists to avoid, and
 * it calls a notice a failure: the step cap is process the same turn can be asked to carry
 * on past, and a real error is not.
 *
 * Matched on the phrase rather than on the whole sentence, because the count is interpolated
 * into it and the wording around it is the SDK's to change.
 */
export function thrownReason(message: string): { reason: TurnEndReason; detail?: string } {
  if (/maximum number of turns/i.test(message)) return { reason: 'max_turns' }
  return { reason: 'error', detail: message }
}
