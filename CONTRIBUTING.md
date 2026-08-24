# Contributing

Glad you are here. This project is a design editor built from scratch, and most of the fun
is that the internals are small enough to actually understand.

## Getting started

```
pnpm install
pnpm dev        # editor on http://localhost:5173, agent sidecar on :5174
```

You need a browser with WebGPU (Chrome, Edge, or Safari 26) and Node 22+. The AI agent
sidecar authenticates through a local Claude Code login; without one, everything except the
assistant panel works normally.

## Before opening a PR

```
pnpm check      # typecheck and tests together
```

Two things reviewers will hold the line on:

- **Geometry and packing changes need a test.** The renderer is testable without a GPU:
  `createStubDevice` in `packages/renderer/src/webgpu/testing/` captures the exact bytes
  `writeBuffer` receives, so a wrong offset fails as a number in the wrong slot. Every
  silent bug this project has had was in that category.
- **The package split is the architecture.** `editor -> renderer -> document`, one
  direction only. The document package has no DOM, the renderer has no React. If a change
  needs to cross a boundary, the answer is a parameter, not an import.

## Where to find your way around

- `CLAUDE.md` is the architecture document: how undo, text, clipping, auto layout and the
  renderer actually work, and why they are built that way. Read the section for the area
  you are touching; it will save you a review round.
- `TASKS.md` is status: what shipped and what is deferred. The deferred lists are full of
  well-scoped work, many with the design already written up.
- Issues labeled `good first issue` are contained and come with file pointers.

## Conventions

- TypeScript strict, no `any`. Explicit return types on exported functions.
- CSS Modules, no inline styles. Design tokens live in `apps/editor/src/styles/tokens.css`.
- WGSL lives in `.wgsl` files imported with `?raw`, never in string literals.
- Hit testing must agree with drawing: a change to what renders reaches
  `packages/document/src/hit.ts` in the same PR.
- No em dashes in UI copy, comments, or docs. Use a period, a comma, or parentheses.
