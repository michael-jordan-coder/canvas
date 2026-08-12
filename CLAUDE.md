# CLAUDE.md

A reverse engineering of Figma. The canvas is drawn with **WebGPU**, everything around it is
**React**. That split is the whole point of the project, and it is the one rule that never bends:
React never draws a shape, and the renderer never knows a component exists.

This repo sits next to `portfolio/` and `generative-ui/` inside `portfolio-projects/`, but it is a
separate repo with its own remote. Nothing here is shared with them.

## The split, and why it is enforced rather than agreed

React is good at trees of components that change when a user acts. It is bad at 120 frames a second
of transform updates during a drag. So the scene never lives in React state.

```
packages/document   the scene. plain TypeScript. no DOM, no GPU, no React.
packages/renderer   WebGPU. reads the document directly. no React.
apps/editor         React panels, input handling, wiring.
```

The boundaries are real module boundaries in a pnpm workspace, so crossing one is an import error
rather than a code review note. Two of them are enforced further by the compiler:

- `packages/document/tsconfig.json` sets `lib: ["ES2022"]` with no DOM. Touching `window`,
  `document` or a canvas from the scene model does not compile.
- `packages/renderer` has DOM and `@webgpu/types` but no React types.

Dependencies point one way only: `editor -> renderer -> document`. If the renderer ever needs
something from the app, the answer is a parameter on the `Renderer` interface, not an import.

## How state actually flows

There are two stores and they hold different kinds of thing.

**The document** (`SceneDocument`) is mutable and lives outside React. The renderer reads it
directly on every frame, so making it immutable would mean allocating a fresh tree 120 times a
second during a drag. It notifies through `subscribe`, and every notification carries a `version`,
the set of changed node ids, and whether the change was structural.

**UI state** (`apps/editor/src/state/uiStore.ts`, Zustand) holds the active tool, the selection and
panel state. None of it is part of the file: two people opening the same document have their own
tool and their own selection. Selection lives here, so when the renderer needs it for selection
handles it gets passed in explicitly rather than read from the scene.

React reads the document only through the hooks in `apps/editor/src/state/scene.ts`. They keep a
revision per node, so a panel showing one node wakes only when that node changes. Dragging a
rectangle must not re-render the layers tree.

Batch related edits in `scene.transact(...)`. Fifty nodes moving should wake the panels once.

## Undo

The model is **inverse snapshots of touched nodes**. Before any node is mutated it is cloned once
per step, and at commit the same ids are cloned again. Undo restores the before clones, redo the
after ones. There are no hand written inverse operations, and no copy of the whole tree.

What makes it correct nearly for free: a node's clone includes its `children` array, so restoring
a parent restores its child order exactly. Deleting a frame and undoing it brings the subtree back
in its original order with no index bookkeeping anywhere.

Three rules the code depends on, all of which have already caused a bug or would have:

- **A transaction is a step.** `#flush` commits the recording, and nested `transact` calls collapse
  into the outermost one. `remove` therefore wraps itself in a transaction, because it recurses:
  without that, each nested call reached depth zero and committed separately, and the frame's
  recorded "before" had already lost the children removed by the earlier steps.
- **First capture wins.** Within a step a node's "before" is how it started, not how it looked
  midway through.
- **Clone on the way in and on the way out.** Handing a stored snapshot to the live document would
  let the next edit rewrite the past.

A drag is many transactions, one per frame, so `beginHistoryGroup` / `endHistoryGroup` merge them
into one step: oldest before, newest after. The input layer opens the group on the first move that
actually changes something rather than on pointer down, so a click that never moves leaves nothing
behind.

Selection travels with each step through `setSideState`, which takes an opaque capture and restore
pair. The document never learns what selection is. **An edit and the selection change that goes
with it belong in the same `transact`**, because the "after" value is captured when the step
commits: delete outside a transaction and redo will restore a stale selection.

History is capped at 200 steps and drops the oldest past that.

## Order and hierarchy

The layers panel lists children **reversed**: index 0 is the back of the stack, because that is
the order the instance buffer is packed and therefore painted, but the topmost thing on the canvas
belongs at the top of the list. Anything computing a drop index has to account for that flip.

`reparent` recomputes the node's local transform against its new parent so it stays exactly where
it appears to be:

```
world  = local  then oldParentWorld
local' = world  then inverse(newParentWorld)
```

Without that a node jumps the moment it enters a differently scaled frame. It also refuses a node's
own descendant as a parent, which would detach that subtree from the tree and leak it.

Z-order commands live in `apps/editor/src/state/order.ts`, not in the document: the scene model
offers `reorder` to an index and the four commands people actually reach for are built on top.
**The order the moves are applied in matters**, because each one shifts the indices of the nodes
not yet moved. Stepping forward and jumping to the back both start from the node nearest that end;
the other two start from the opposite one. Getting it wrong either collapses a multiple selection
onto itself or reverses it, and both are covered by tests.

## Persistence and the clipboard

`packages/document/src/serialize.ts` is the only place untrusted input enters the app, so it
validates by hand rather than trusting a cast, and every failure names the path that failed
(`nodes[3].opacity is not a finite number`) instead of saying "invalid". `SCHEMA_VERSION` is
written into every file and a future version is refused rather than half read.

The saved shape is flat: a list of nodes, with structure carried by each node's `children`.

`document.load(root, nodes)` replaces the contents **in place**. That is not an implementation
detail: the editor holds one document as a module singleton and every React hook and the renderer
subscribe to it, so swapping in a new instance would leave them all watching an object nothing
writes to. Loading also pushes the id generator past every id in the file, since a loaded document
keeps its ids and the next node created would otherwise collide with one of them.

The editor autosaves to `localStorage` 600ms after edits stop, and flushes on `pagehide` so a tab
close does not drop the pending write. A save that will not parse is moved to
`figma-canvas:document.unreadable` rather than overwritten, because silently starting from a blank
document looks exactly like losing someone's work. **To get the seeded scene back, clear
`figma-canvas:document` in local storage.**

Copy, cut and paste use the real clipboard events rather than the async clipboard API, so the JSON
rides on the system clipboard: paste works between two tabs of the editor, with no permission
prompt and no user gesture needed to read. Text from anywhere else fails to parse and is ignored,
which is not an error.

Paste and duplicate share `instantiateSubtree`, which assigns fresh ids and rewrites every parent
and child reference to match. A selection containing both a frame and one of its own children
collapses to just the frame, so the child is not pasted twice.

## Commands

```
pnpm dev         editor on :5173
pnpm build
pnpm typecheck   every package
pnpm test        vitest, whole workspace
pnpm test:watch
pnpm check       typecheck and test together
```

Tests sit next to what they cover as `*.test.ts`. Vitest resolves the `@figma-canvas/*` imports
through the pnpm links, so tests import the packages exactly as the app does, with no build step.

The renderer is testable without a GPU: `createStubDevice` in
`packages/renderer/src/webgpu/testing/` captures the exact bytes `writeBuffer` would have received.
That is what makes packing bugs catchable, because a wrong offset shows up as a number in the wrong
slot rather than as a shape drawn in the wrong place. **Geometry and packing must have a test.**
Every silent bug this project has had was in that category.

## Performance

`?stress=10000` seeds a grid of that many nodes instead of loading the saved document, and
`?perf` (implied by `?stress`) shows a readout of instances drawn, instances culled, build time and
frame time. Autosave is off in stress mode, so throwaway nodes are never persisted.

Measured on a 10,000 node grid, CPU side. **These were taken when an instance was 64 bytes and
have not been retaken since it grew to 80 for the clip index**, so read the build rows as a floor
rather than a current figure:

| | |
| --- | --- |
| Insert 10,000 nodes | 14ms, once |
| Build the buffer, nothing culled | 16.3ms for 10,000 instances |
| Build it culled to a 1600x1000 viewport | 4.0ms for 459 instances |
| Pan inside the built margin | 1000 calls in 0.86ms, so free |
| Pan that leaves the margin | about 2ms per rebuild |

Culling and caching pull against each other: the buffer is cached against `document.version` so
panning costs nothing, but a culled buffer depends on where the camera is. `CULL_MARGIN` builds
half a viewport past the edges and rebuilds only when the view leaves that region, which keeps the
common case free.

**The remaining 4ms is the walk over all 10,000 nodes, not the packing of the 459 visible ones**, so
the next win is a spatial index, not more culling. Nothing needs it yet.

Port 5173 is deliberate and `strictPort` is on. The other two repos in this folder both want 3000
and silently land on each other's ports. This one stays out of that fight.

## Conventions

- TypeScript strict, no `any`. Explicit return types on exported functions.
- CSS Modules. Never inline CSS in a component. A dynamic color goes on an SVG presentation
  attribute (see the fill swatch in `PropertiesPanel`), not on a `style` prop.
- Design tokens live in `apps/editor/src/styles/tokens.css`. Light is the default because artwork
  has to be judged against a neutral surround. Dark is `data-theme="dark"` on `<html>`. Greys are
  true neutral so the one accent always means something: selected, active, focused.
- WGSL shaders are separate `.wgsl` files imported with `?raw`. No shader source inside a `.ts`
  string literal, because that loses syntax highlighting and makes diffs unreadable.
- No em dashes anywhere: UI copy, comments, commit messages, docs.
- Commit only when Daniel asks. Never push.

## What exists and what does not

Built:

- The scene model: nodes, affine transforms, paints, the mutable store with batching and per node
  change notification.
- The camera: pan and zoom math, screen to world, zoom around a point, fit to rect. All of it is
  pure and testable without a GPU.
- The `Renderer` interface the app is written against.
- The editor shell: toolbar, layers tree, properties panel. The property fields edit the document
  for real, which is how the store and the hooks are verified without any rendering.
- `CanvasHost`, which owns the canvas element, the device lifecycle and the draw schedule,
  including the `devicePixelRatio` change that fires no resize event when a window moves
  between displays.
- **The WebGPU renderer** in `packages/renderer/src/webgpu/`. The whole document draws in one
  instanced call: every shape is the same four corner quad, and what it actually is gets decided
  per pixel in the fragment shader by a signed distance function. Corner radii and edges stay
  exact at any zoom because nothing is ever tessellated, and `fwidth` converts distance to
  coverage in whatever units the view happens to be at.
- Pan and zoom, through a camera uniform holding one world to clip matrix. Moving the view is
  one 48 byte write and touches no geometry, which is why a document of any size pans as cheaply
  as an empty one.
- Strokes, as a second instance of the same shape rather than a wider one. Given the SDF an
  outline is the band `abs(d - offset) <= weight / 2`, so a stroke instance is the same 80 bytes
  as a fill with two more slots filled in, and a node without one pays nothing. Alignment is
  carried entirely by the sign of that offset: `-weight / 2` inside, `0` centred, `+weight / 2`
  outside. `strokeOffset` and `strokeOutset` in `paint.ts` are the single source for it, shared
  by packing, culling and hit testing.
- `clipsContent`, as a per instance index into a storage buffer of clip records rather than a
  scissor rect. Each record holds the frame's **inverse** world transform, its size and radius,
  and the index of the clip enclosing it, so the fragment shader maps its own world position back
  into each frame in turn and walks that chain outward. Nesting therefore needs no intersection
  on the CPU, and a scaled frame clips correctly, which an axis aligned screen rectangle would
  not. It also keeps the whole document in one draw call.

Drawing is on demand, not a permanent `requestAnimationFrame` loop. `CanvasHost` redraws on
resize and on document change, coalesced into one frame. An editor is static most of the time and
a loop running at 120Hz over a still document burns battery producing identical pixels.

The instance buffer rebuilds only when `document.version` changes, so it is untouched by panning.
Shapes are packed back to front and blended in that order, which is why there is no depth buffer:
overlapping translucent shapes need painter's order and a depth test would discard their blending.
A node contributes its fill, then its whole subtree, then its stroke, so a frame's outline is not
painted over by a child that fills it edge to edge. For a leaf that ordering is identical.

Two rules in the shape shader are not obvious and both have a wrong version that still renders:

- **`fwidth` is taken on the raw distance, before the `abs` that forms a stroke band.** That `abs`
  creases down the middle of the band, and a derivative across the crease reads as enormous, which
  paints a soft seam along the centre of every thick stroke.
- **A sub-pixel stroke widens inward only.** The quad is padded on the CPU by the stroke's
  geometric reach, so a hairline that grows symmetrically to stay visible at low zoom would push
  past the quad and have its outside sliced off. Pinning the outer edge and moving the inner one
  keeps the two in agreement at every zoom.

Derivatives inside the clip walk would be illegal, since they are only defined in uniform control
flow. `dpdx` and `dpdy` of the world position are taken once by the caller and pushed through each
frame's inverse instead, which gives the pixel's footprint in that frame's units: what `fwidth`
would have returned had it been callable there.

- Hit testing (`packages/document/src/hit.ts`) and drag (`apps/editor/src/input/pointerInput.ts`).
  Hit testing uses the same rounded box distance function as the fragment shader, so what you can
  click is exactly what you can see, corner radius bites included. That equivalence is the reason
  every change to what gets drawn has to reach `hit.ts` in the same step: an outward stroke grows
  the clickable area by its reach, and a clipping frame stops a click from finding a child it has
  hidden. `nodesIn` carries the same clip as a world rect, so a marquee cannot catch an overhang
  that is not on screen. A frame clips to its geometry and deliberately not to its stroke, since
  painting a thick outline on a frame must not enlarge where its children may appear. Input reads
  the stores through `getState` rather than subscribing, because a drag must not put a React
  render between the pointer and the pixels.

- The selection overlay: outline and eight handles, drawn by a second pipeline bound to a pixels
  to clip matrix instead of a world to clip one. That is the whole trick. Its geometry is built in
  CSS pixels and never sees the camera, so a handle is 8px at 10% zoom and at 3000%, and a one
  pixel outline stays one pixel. Both pipelines share `MatrixUniform`; they differ only in which
  matrix they are bound to.

`Renderer.render` takes a `ViewState` rather than a camera, because selection is drawn but is not
in the document. It is passed in once per frame instead of read, so the dependency keeps pointing
one way. `CanvasHost` subscribes to the UI store separately to redraw when selection changes.

Clicking selects the deepest node under the cursor, so a rectangle inside a frame selects the
rectangle. Figma selects the outermost frame and makes you double click to descend. That is a UI
policy rather than a geometry question and it lives above `hitTest`, which is why the function
returns the deepest hit and lets the caller decide.

## Planned work lives in Notion, not here

**This file does not list future work.** It describes what exists and why it is built the way it
is. Planned and in progress work lives on the Figma Canvas Tasks board:

https://app.notion.com/p/3bac9dc0ddd981bcb20aef1149effb4e

Two records that both claim to say what is left will drift within a week, so they are split by
job: Notion owns status, this file owns architecture. When something ships, describe it above and
mark it Done on the board.

**Do not open the board from the main session.** The `notion-tracker` agent
(`.claude/agents/notion-tracker.md`) owns every read and write to it, so page ids and property
payloads never enter the conversation. Delegate to it and relay its one line back.

A few things are worth knowing because the code looks finished but is not:

- Only `fills[0]` and `strokes[0]` are read. The model holds arrays because Figma stacks paints,
  and nothing above the first one is drawn.
- Clipping is honoured per pixel but not yet used to cull. A subtree entirely outside its clipping
  frame is still walked and packed, only to be thrown away by the fragment shader. Skipping it
  would be a real win on a deep document and would also make the `culled` figure in the perf
  readout a lie unless the skipped instances are counted some other way.
- The selection outline is axis aligned. A rotated node would get an upright box around it.
- The selection box and the resize handles follow the node's `size`, so an outward stroke sits
  outside them. That is deliberate, because the handles edit `size` and have to line up with what
  they change, but it does mean the box is not the drawn bounds.
- The accent colour is hardcoded in `OverlayInstances` because the renderer has no access to CSS.
  It needs passing in when the theme toggle exists, since dark uses a lighter blue.
