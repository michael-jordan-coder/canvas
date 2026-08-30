/**
 * How long to wait before trying the socket again.
 *
 * A flat two seconds meant an editor left open beside a stopped server reconnected thirty
 * times a minute forever. Backing off keeps the first retry immediate enough that a server
 * started a moment later is picked up at once, and a tab left open overnight is not busy.
 *
 * Its own module because `connection.ts` reaches the scene, which reads localStorage as it
 * loads, so nothing that imports it can be tested in a node environment.
 */
export const RECONNECT_BASE_MS = 1000
export const RECONNECT_MAX_MS = 15_000

/** Doubling from the base, capped: 1s, 2s, 4s, 8s, then 15s for as long as it stays down. */
export function reconnectDelay(attempt: number): number {
  const steps = Math.max(0, Math.floor(attempt))
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** steps)
}
