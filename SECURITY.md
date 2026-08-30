# Security

## Reporting a vulnerability

If you find a security issue, please do not open a public issue for it. Instead, use
[GitHub's private vulnerability reporting](../../security/advisories/new) for this
repository, or contact the maintainer directly through their GitHub profile.

Include what you found, how to reproduce it, and the impact if you can assess it. Expect an
acknowledgment within a few days.

## Scope

This is a client-side design editor plus a local AI agent sidecar (`apps/agent-server`) that
only accepts connections from the editor's own origin, using a per-run token. See the
"assistant" section of [CLAUDE.md](CLAUDE.md) for how that boundary is enforced and its known
limits. Reports about that boundary, about `packages/document/src/serialize.ts` (the only
place untrusted file/clipboard input is parsed), or about `packages/document/src/code/validate.ts`
(validation of the code node's worker output) are especially welcome.
