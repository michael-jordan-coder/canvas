import type { TurnEndReason } from '@canvas/agent-server/protocol'
import type { ChatItem } from './agentStore'

/**
 * What a turn's ending says in the transcript, or null when it says nothing.
 *
 * The words live here rather than on the server for the same reason "Stopped." and "Not
 * sent: the assistant was still working." do: they are the assistant's voice, and a voice
 * split across two processes has to be kept in tone by hand. The server sends a reason,
 * which is the part only it can know.
 *
 * The kind is the other half of the reason's job. A stop is a state the person put the turn
 * in, and the step cap is process the same conversation can carry on past, so both are
 * notices; only a real failure is an error. A turn that quietly failed must not read as a
 * turn that worked, and a turn that merely ran long must not read as one that broke.
 */
export function turnEndItem(
  reason: TurnEndReason,
  detail?: string,
): { kind: ChatItem['kind']; text: string } | null {
  switch (reason) {
    case 'ok':
      return null
    case 'stopped':
      return { kind: 'notice', text: 'Stopped.' }
    case 'max_turns':
      return {
        kind: 'notice',
        text: 'The assistant reached its limit of steps for one turn.',
      }
    case 'error':
      return {
        kind: 'error',
        // The detail is an SDK subtype or a thrown message, so it is named rather than
        // shown alone: on its own it reads as though the app is talking to itself.
        text: detail
          ? `The assistant hit an error partway through (${detail}).`
          : 'The assistant hit an error partway through.',
      }
  }
}
