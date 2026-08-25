/**
 * Which code-node sources may run without the person asking, for this session only.
 *
 * A code node's `source` is arbitrary TypeScript that sucrase compiles and `new Function`
 * runs inside the code worker, on the editor's own origin. Source that arrived from outside
 * the session (a loaded file, a paste from another tab or another app, the autosaved document
 * restored on reload) is untrusted input under the `serialize.ts` rule, so it must not run
 * until the person asks for it. Source the person authored or edited here, and source the
 * agent wrote through its tools, is trusted; running an untrusted node once through the panel
 * trusts it from then on.
 *
 * Keyed by the source string rather than the node id. A duplicate is a fresh id but the same
 * source, so duplicating a node authored this session carries its trust, and a loaded file
 * that happens to reuse an id inherits none. Nothing is persisted: a reload starts with an
 * empty set, which is exactly what stops a saved payload re-running on every open.
 */
const trustedSources = new Set<string>()

/** Marks a source safe to run this session. Called wherever a person or the agent authors one. */
export function trustCodeSource(source: string): void {
  trustedSources.add(source)
}

/** Whether a source has been authored, edited or explicitly run this session. */
export function isCodeSourceTrusted(source: string): boolean {
  return trustedSources.has(source)
}
