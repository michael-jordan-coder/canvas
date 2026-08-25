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
