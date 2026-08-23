# CLAUDE.md

A reverse engineering of Figma. The canvas is drawn with **WebGPU**, everything around it is
**React**. That split is the whole point of the project, and it is the one rule that never bends:
React never draws a shape, and the renderer never knows a component exists.

There is now one thing on the canvas React does draw, and it is the exception that states the
rule: a **component node** is a real React component, mounted through React DOM in a layer
between two GPU surfaces. The renderer still does not know it exists, because a component node
packs no instances at all. See "React components on the canvas" below.

This repo sits next to `portfolio/` and `generative-ui/` inside `portfolio-projects/`, but it is a
separate repo with its own remote. Nothing here is shared with them.

## The split, and why it is enforced rather than agreed

React is good at trees of components that change when a user acts. It is bad at 120 frames a second
of transform updates during a drag. So the scene never lives in React state.

```
packages/document   the scene. plain TypeScript. no DOM, no GPU, no React.
packages/renderer   WebGPU. reads the document directly. no React.
apps/editor         React panels, input handling, the component registry, wiring.
apps/editor/vite-plugins  dev-time Node code: reads the component library off disk.
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
written into every file and a future version is refused rather than half read. It is at 6,
which added the component node.

A component's props are validated key by key like everything else, because a saved prop is
handed to a real React component: a nested object where a string was expected would reach
something that has no reason to survive it. A component **key** the registry does not know is
deliberately not an error, though. That is a valid file this build cannot fully render, and
dropping the node would silently edit someone's document on load.

The saved shape is flat: a list of nodes, with structure carried by each node's `children`.

`document.load(root, nodes)` replaces the contents **in place**. That is not an implementation
detail: the editor holds one document as a module singleton and every React hook and the renderer
subscribe to it, so swapping in a new instance would leave them all watching an object nothing
writes to. Loading also pushes the id generator past every id in the file, since a loaded document
keeps its ids and the next node created would otherwise collide with one of them.

The editor autosaves to `localStorage` 600ms after edits stop, and flushes on `pagehide` so a tab
close does not drop the pending write. A save that will not parse is moved to
`figma-canvas:document.unreadable` rather than overwritten, because silently starting from a blank
document looks exactly like losing someone's work. **To get the seeded scene back, put
something unparseable in `figma-canvas:document` and reload, from a document with no edit
pending.** Removing the key does not work: the `pagehide` flush writes the live document
straight back on the way out, so the save is there again before the next load reads it. An
unparseable value survives that, because the quarantine above is what handles it, but only if
nothing is waiting to be written. Reload once to settle any pending save, then poison it.

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
have not been retaken since it grew to 80 for the clip index and then to 96 for the four corner
radii**, so read the build rows as a floor rather than a current figure:

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
  outline is the band `abs(d - offset) <= weight / 2`, so a stroke instance is the same 96 bytes
  as a fill with two more slots filled in, and a node without one pays nothing. Alignment is
  carried entirely by the sign of that offset: `-weight / 2` inside, `0` centred, `+weight / 2`
  outside. `strokeOffset` and `strokeOutset` in `paint.ts` are the single source for it, shared
  by packing, culling and hit testing.
- A stack of paints per node, each one its own instance, which is the stroke trick applied a
  second time. Painter's order composites the stack for free because the instances are
  contiguous, so there is no second pass and no blending to arrange. Two rules go with it. The
  list runs **the opposite way to the buffer**: the panel puts the topmost paint in the first
  row, the way Figma does, so `fills[0]` is emitted last and lands on top. And a paint carries
  its own `opacity` and `visible`, both optional with absence meaning the default, which is why
  they cost no schema version. Opacity multiplies into `color.a` at pack time alongside the
  alpha inherited from the tree, so the colour's own alpha, the paint's and the node's compose
  rather than override. `drawnPaints`, `drawnStrokes` and `strokesOutset` in `paint.ts` are the
  single source for all of it, shared by packing and hit testing exactly as the stroke helpers
  are. Text is the one case that is a pass per paint rather than a paint per glyph, so a second
  colour lands over the whole word instead of interleaving where two glyphs overlap.
- `clipsContent`, as a per instance index into a storage buffer of clip records rather than a
  scissor rect. Each record holds the frame's **inverse** world transform, its size and radii,
  and the index of the clip enclosing it, so the fragment shader maps its own world position back
  into each frame in turn and walks that chain outward. Nesting therefore needs no intersection
  on the CPU, and a scaled frame clips correctly, which an axis aligned screen rectangle would
  not. It also keeps the whole document in one draw call.

- Per corner radii, as a fifth vertex attribute rather than as four numbers squeezed into the
  spares. `packages/document/src/sdf.ts` owns both halves of the geometry: `resolveCornerRadii`
  and the TypeScript twin of `sdRoundedBox`. Resolution is CSS's, a **single scale factor across
  all four radii** rather than a clamp per corner, because two radii clamped independently still
  overlap on a shared edge and fold the distance field there, and drawing and hit testing then
  disagree in exactly that region. It runs once per instance on the CPU because it needs all four
  radii and both sides at once and gives the same answer for every pixel. The packer, the clip
  table and `hit.ts` all consume its output, which is what stops them being three careful
  reimplementations of one clamp. In the shader the corner is chosen by the sign of `p` **before**
  the `abs`, since that fold maps all four quadrants onto one and takes the evidence with it.

- Premultiplied alpha out of the shape shader, with `one / one-minus-src-alpha` on both colour and
  alpha. Byte identical to straight alpha here, because the surface is `alphaMode: 'opaque'` and
  the pass clears to `a = 1`, so destination alpha is 1 for the whole pass and the two agree. It
  is a prerequisite rather than a fix: every blend mode other than source over reads the colour
  channels directly, and a straight alpha source would draw a dark fringe along every antialiased
  edge.

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

- The selection overlay: outline, eight handles and the rotate handle on its stem, drawn by a
  second pipeline bound to a pixels to clip matrix instead of a world to clip one. That is the
  whole trick. Its geometry is built in CSS pixels and never sees the camera, so a handle is 8px
  at 10% zoom and at 3000%, and a one pixel outline stays one pixel. Both pipelines share
  `MatrixUniform`; they differ only in which matrix they are bound to.

- Text, as a node type, a pure layout, an MSDF atlas and an inline editor. It draws in the
  same instanced call as everything else. See the text section below.

- **Real React components on the canvas.** A component node names a registry entry and carries
  a bag of scalar props; the editor mounts the actual component through React DOM in a layer
  between the document's GPU surface and the overlay's. It is dragged in from a component
  panel, selected and moved with the same hit testing every other node uses, edited from the
  properties panel, and it keeps its own React state through a pan, a zoom and a prop change.
  The renderer packs **nothing** for it. See the section below.

- Rotation. The transform was always a full affine, so the renderer needed no change at all: a
  turned node draws correctly the moment its matrix says so. What rotation actually cost was
  everything built on the assumption that a selection is upright.

`Renderer.render` takes a `ViewState` rather than a camera, because selection is drawn but is not
in the document. It is passed in once per frame instead of read, so the dependency keeps pointing
one way. `CanvasHost` subscribes to the UI store separately to redraw when selection changes.

## Text

Text is the first thing here that is not an analytic shape, and the whole design is about
giving up as little as possible for it.

**A glyph is an instance in the same buffer as every shape.** Not a second pipeline and not a
second draw call. The 96 byte instance has six slots a letter has no use for, and a glyph
needs five: `params.x` and `params.z` are the top left of its patch of the atlas, `params.w`
the right edge, and two spare slots in `flags` carry the bottom edge and the distance range.
Kind and clip index stay exactly where a shape keeps them, because the shader reads both
before it knows what it is looking at. So text inherits culling, opacity, the clip chain and,
most importantly, **paint order**: a rectangle drawn over a word covers it, which a separate
text pass could not manage without splitting the shape draw around every text node.

**The atlas is multi-channel and baked, not rasterised.** `packages/renderer/src/font/` holds
Inter Regular, a 512x512 MSDF atlas and the metrics that go with it, with the exact bake
command and the reason for every flag in its `README.md`. A single channel field rounds off
anything sharper than its own radius, which is why one channel makes the corner of a letter
read soft at high zoom; the median of three recovers it. 1 MB on the GPU, uploaded once.

Three rules in the shader, all of which have a wrong version that still compiles or still
renders:

- **`textureSampleLevel`, never `textureSample`.** WGSL's uniformity analysis treats the kind
  flag as non-uniform, because it is an interpolated varying, so the plain one fails to
  compile inside the glyph branch however uniform that branch is in practice. An explicit LOD
  is legal anywhere, and an MSDF wants no mipmaps regardless.
- **Every derivative is taken at the top of the fragment stage, before anything branches.**
  Same reason the clip walk takes its own from the caller, now applying to three of them.
- **`outset` returns 0 for a glyph.** It reads the stroke slots, which on a glyph hold texture
  coordinates, and padding a quad by them grows every letter by a fraction of its own size.
  That reads as imprecision rather than as a bug, which is what makes it worth a guard.

**Layout is pure, lives in `packages/document`, and takes its font as a parameter.** This
package cannot measure text, having no DOM, but it does not need to: a baked atlas ships its
advances and line metrics as data, and that is the whole of what layout reads. The editor and
the renderer call the same `layoutText`, which is not a tidiness point. The editor writes the
measured bounds onto the node and draws the caret from them, the renderer packs one instance
per glyph, and two layouts that could disagree would put the caret beside the text.

**There is one laid out copy of each text node, in `TextLayoutCache`.** Four places want the
same answer for the same node in the same frame: the packer emits an instance per glyph, the
overlay places the caret and the selection highlight, the input layer maps a click to an
offset, and `updateText` measures the bounds it writes back. A keystroke used to pay for three
of those, and an idle caret blink for one twice a second, over text nobody had touched since
typing it. Measuring through the cache is what makes the frame after a keystroke free: the
layout is keyed by the text the edit is about to write, so the packer and the caret read it
back rather than building it twice more.

The cache is created in `apps/editor/src/state/font.ts` and handed to the renderer through
`RendererInit`, not owned by it. It has to outlive a renderer, since a strict mode remount or
a lost device would otherwise throw away every layout in the document, and it has to be
reachable from the input layer, which has no renderer at all.

Eviction is two maps swapped by `sweep`, so an entry survives one sweep untouched and falls
out on the next, and reading promotes. **The instance buffer's rebuild is the sweep**, because
that walk is the only one that visits every node and so the only one that can tell a node
still in the scene from one that was deleted. It is also the only thing that can invalidate a
layout, since it runs on every document change.

One convention runs through all of it: **y grows downward, the origin is the pen position on
the baseline, and offsets are UTF-16 code units.** That is why `ascender` is negative, why the
atlas is baked `-yorigin top`, and why a caret can be handed to and from a textarea with no
conversion. Iteration is by code point, so an astral character is one glyph at two offsets and
a caret cannot land inside it.

**A text node's `size` is a cache, not a setting.** It is the measured bounds, and the rule is
that whatever writes the text writes the size in the same transaction. Hit testing and the
selection box need bounds and cannot compute them, which is why they live on the node at all.
`apps/editor/src/state/font.ts` remeasures every text node once the font arrives, since a
saved file loads synchronously from local storage while the atlas comes over the network, and
that is also what keeps a document honest across a change of font.

**A text node offers two resize handles, east and west, and no others.** Its width is a real
setting, because it is the width lines wrap to. Its height is not: it is however many lines
that produces, so a south handle would be offering to fight the layout. `resizeHandlesFor` is
asked by both the overlay and the input layer, so what is drawn and what is grabbable cannot
disagree, and `handlePoints` takes that set because the crowding minimum that hides an edge
handle on a short box only exists to keep it off a corner one. With no corners in the set
there is nothing to crowd, and without that exception a line of text, always shorter than the
minimum, would offer no handles at all.

Dragging either handle is what turns the box **fixed width**: `autoWidth` goes false and from
then on `size.width` is the wrap width and only the height is measured. The panel's W becomes
editable at the same moment, and an Auto width toggle turns it back, because nothing else in
the editor returns a box to sizing itself to its words and a one way door is not a setting.

Wrapping is greedy and breaks at spaces, with two rules that are only visible when they are
wrong: a trailing space hangs past the edge rather than pushing a line over, since a line that
broke on the space you just typed would look broken; and a single word longer than the box
breaks mid-word, because letting it overflow would draw text outside the bounds that are hit
tested. A non-breaking space is deliberately not a break opportunity, which is the whole
reason it exists.

### Inline editing: what is DOM and what is GPU

An invisible `<textarea>`, focused, is the only DOM part. It is what makes dead keys,
autocorrect and an IME candidate window work, none of which can be reimplemented on top of raw
keydown events. It is emphatically not what you see: the glyphs come from the renderer and the
caret and selection highlight from the overlay pipeline, passed in through `ViewState` exactly
as the marquee already is. The text is therefore never on screen twice and nothing can jitter.

Five things about that field are load bearing, and every one of them presents as a bug
somewhere else:

- **Opacity zero, not `display: none` or `visibility: hidden`.** Both of the latter stop an
  element receiving composition events, which takes every IME with them.
- **The pointer down that opens the editor calls `preventDefault`.** Clicking a canvas moves
  focus to the body, which would blur the field a moment after it was focused.
- **The caret comes from a `selectionchange` listener on the document, not React's
  `onSelect`.** React polyfills that one from a narrow set of events and it never fires for a
  caret moved by the keyboard, which is most of how a caret moves.
- **The field is synced from the document in a layout effect.** It is uncontrolled, so it
  starts empty, and anything reaching it before the sync would report an empty value and blank
  the node. Controlled would close that window and fight the IME instead.
- **That sync writes the text and the caret on different terms.** The text always, the caret
  only when it moved for a reason outside the field. Typing is a discrete event, so React
  flushes the commit synchronously and the layout effect runs while `selectionchange`, which
  is queued, has not arrived: the caret in the store is still the one from before the
  keystroke. Writing it back drags the caret to the front of the field and pins it there, so
  every further character lands at offset zero and `abc` is typed as `cba`. The effect keeps
  the last caret it applied and compares against that, which distinguishes a caret the field
  moved itself from one an undo, a click or a replaced value moved.

`TextEditor` returns null rather than unmounting when nothing is being edited, so **the typing
history group cannot live in the component**: a cleanup that never runs would leave the group
open, and every later edit in the session would silently fold into a step that never commits.
It lives at module scope and `endEditing` closes it. A burst is one undo step, opened on the
first keystroke and closed after 600ms of quiet, on blur, on commit, or on window blur, which
is the same shape and the same safety net the arrow key nudge uses.

## Auto layout

Frames can lay their children out in a row or column: `FrameLayout` on the frame (direction,
gap, per-side padding, main and cross alignment, hug or fixed per axis), `LayoutChild` on any
node (fixed or fill per axis). Absence of `layout` is what "no auto layout" is; there is no
`'none'` value, so old files need no field and one presence check answers every caller.

**The engine is pure and lives in `packages/document/src/layout/autoLayout.ts`.** It reads
the document and returns patches; it never writes. There are two kinds of node it cannot size
itself, text and a mounted component, and both come back through one `NodeMeasurer` registered
by `state/measure.ts` through `setNodeMeasurer` rather than imported, because importing either
half drags the atlas fetch, the live scene and a React root into every test that touches a
command module. One slot and two halves is why neither half registers itself: whichever module
was imported second would silently replace the first.

Two properties everything downstream leans on:

- **Idempotent.** Every write is epsilon-compared against what the node holds, so a settled
  document produces zero patches: no version bump, no history step, no instance-buffer
  rebuild, and no cost in stress mode. It is also what makes cancelling a gesture exact:
  restore the inputs, relayout, and the siblings land where they started.
- **Resolved once.** A child's final size is computed in one call carrying every constraint
  that applies to it. Fill against a hug axis degenerates to fixed, because a child sized by
  the frame while the frame is sized by the child has no answer; setting Fill in the panel
  flips the frame's own axis to fixed for the same reason, which is Figma's resolution too.

**Invocation is push, never subscribe.** Every mutation that can disturb a layout calls
`relayout` (`apps/editor/src/state/autoLayout.ts`) inside its own transaction, so the
layout's writes land in the same history step as the edit that caused them, and undo/redo
never run layout at all: a step's snapshots already hold both. A subscriber could not do
this: `#flush` runs listeners after depth reaches zero, so a listener's write is a second
step, and it would also fire during undo. The cost of push is that the call sites are
enumerated rather than implied; the list lives in TASKS.md and the grep for `relayout(` is
the audit.

`layoutRootsFor` climbs from each dirty node to the topmost auto-layout ancestor, because a
hug axis hands its size upward and the chain solves from the top. On a document with no auto
layout the walk is one or two steps to nothing, which is what keeps `?stress` free.

The reorder drag (`applyFlow` in `pointerInput.ts`): a single dragged child of an auto frame
**floats with the pointer and is excluded from every layout pass**, so the siblings shift
around an open slot; entering a frame reparents live, leaving hands the node to whatever is
under the pointer, and the release runs one pass without the exclusion, which is what snaps
the node in. A live reparent rebases the drag against the new parent, but each dragged node
keeps an untouched `origin` (parent, index, transform), because Escape has to reach past
every rebase: it restores parent, then index, then transform, then relayouts, and
determinism does the rest. Dragging a resize handle claims the axes it moves: a hug axis
flips to fixed exactly as a text box loses `autoWidth` to the same gesture, and the captured
`startLayout` is how Escape gives the hug back.

Text inside auto layout: fill-width assigns the wrap width, so the engine emits
`autoWidth: false` with the size, and height comes from the measurer through the shared
`TextLayoutCache`, warming the entry the renderer packs a frame later. Before the font
arrives the old height stands; `remeasureAll` relayouts everything when it lands, then
clears history, since measuring is not an edit. Invisible children leave the flow entirely
(locked ones stay), a hidden child's toggle relayouts, and enabling auto layout infers
direction, gap, padding and flow order from where the children already sit, so Shift+A moves
nothing. On anything that is not a single frame, Shift+A instead wraps the selection in a
new frame drawn 10 around its bounds (`wrapInAutoLayout`): hug on both axes, no clip, no
fill, and the wrapped nodes keep their world positions, so the padding infers to exactly
that margin and the wrap is a regrouping rather than a rearrangement. One undo removes it
entirely, old selection included.

## React components on the canvas

A **component node** is an instance of a real React component: `Button`, `Input` or `Card`
today, whatever the registry holds tomorrow. It is the one thing on the canvas the GPU does
not draw, and everything about it is arranged so that stays an exception rather than a crack.

**The document holds a key and a bag of scalars, and nothing else.** `ComponentNode.component`
is a registry key, `props` is `Record<string, string | number | boolean>`. `packages/document`
has no DOM and no React and does not gain either: it cannot hold a component type, so it
holds a name for one. Anything richer than a scalar could not be cloned by history, written
by the save format, or sent over a wire to a collaborator, which is the same list of reasons.

**A component node has bounds without having paint.** Those used to be one question, answered
by `isPainted`, and the split into `isPainted` and `hasBounds` is what makes the whole feature
work: the packer asks about paint and finds none, so a component contributes **zero
instances**; hit testing, the selection box and auto layout ask about bounds and get the box.
`ShapeInstances.test.ts` pins the zero, because the day the GPU starts drawing a stand-in is
the day the canvas and the mounted component begin to disagree.

### Three layers, and why the renderer has two surfaces

```
the document        a GPU surface, opaque
the component layer React DOM, one shadow root per component
the overlay         a GPU surface, transparent: outline, handles, marquee, caret
```

A frame's fill has to be **behind** the components it contains, and a selected component's
outline and handles have to be **in front** of it. One surface cannot be on both sides of a
piece of DOM, so `createGPUSurface` configures two canvases on one device and `render` runs
its two passes into them separately. The overlay costs nothing extra to composite correctly:
its pipeline already blends `src-alpha / one-minus-src-alpha` on colour and
`one / one-minus-src-alpha` on alpha, which against a cleared transparent target produces
exactly premultiplied output. No shader and no blend state changed for the split.

The overlay pass runs even with nothing to draw, because the clear is the point: skipping it
would leave the previous frame's handles on screen after the selection was dropped. And the
overlay canvas hides itself when the device is lost, since a surface with no device presents
opaque and would take the entire component layer off screen with it.

### Alignment is by construction, not by agreement

The layer's root carries `viewMatrix(camera, viewport)` as a CSS `matrix()`. That is the same
function the world to clip matrix is built from, so the two layers cannot drift: they are not
two implementations that agree, they are one matrix used twice. `Mat2D` and CSS `matrix()`
have the same component order, so writing one into the other is a spelling rather than a
conversion.

Below the camera the nesting does the composing: one element per artboard carrying the frame's
world transform, and one element per component carrying its own local transform. A frame full
of components is therefore **one** transform update per pan, not one per component, and a
rotated or scaled frame carries its components with it for free.

The camera is written imperatively, into a custom property, from a subscription. A pan is a
hundred and twenty of those a second and none of them is a React render. That is also why the
camera moved out of a ref inside `CanvasHost` into `state/viewport.ts`: two layers reading the
same numbers has to mean the same object, not two copies that are usually equal.

### Isolation, and what it is not

Each component gets a **shadow root**, with the library's stylesheet adopted into it (one
constructed sheet, shared, rather than a `<style>` per mount). The editor's tokens, resets and
panel styles stop at the boundary, and so does anything the components do to buttons and
inputs. An iframe would isolate more and cost far more: a document, a stylesheet and a React
root per artboard, and every pointer coordinate crossing a frame boundary. A shadow root is
the amount of isolation this needs.

The positioning stays outside the shadow root, in the editor's own CSS modules. Only what the
component renders is inside it.

### Design and preview, which is entirely about who gets the pointer

In **design mode** the layer is `pointer-events: none`, so every click reaches the canvas and
selection, dragging, resizing and hit testing are unchanged: a component is selected by the
same `hitTest` a rectangle is, and its bounds and handles are drawn by the same overlay. In
**preview mode** each mount takes its events back and behaves as it would in a real
application, while the canvas keeps only pan and zoom. Nothing remounts across the switch, so
the state inside a component survives it.

Preview also silences the keyboard and clipboard shortcuts, and `isEditingText` cannot stand
in for that: an event from inside a shadow root is **retargeted to the host element** on its
way out, so a copy from a real input in a previewed component looks to a window listener like
a copy from a plain div, and would copy the selected nodes instead.

### Size is a cache of the render, measured synchronously

A component node's `size` is what its component renders at, in exactly the sense a text node's
`size` is its laid out text, and it carries the same rule: **whatever writes the props writes
the size in the same transaction**. Hit testing and the selection box need the box and cannot
measure a component, so a box that lagged its contents would be a component you can see in one
place and click in another.

Measurement renders the component into an offscreen root with the same shadow root and the
same stylesheet, and reads the layout back through `flushSync`. A `ResizeObserver` on the real
mount would be the obvious way and would arrive a frame late, outside the transaction that
caused it: the measurement would either land in the next edit's undo step or open one of its
own, and a session would accumulate history steps nobody performed. Measurements are cached by
component, props and width, because auto layout measures a fill width child on every pass and a
pass runs on every frame of a drag through the frame that holds it.

`autoSize` is the text node's `autoWidth` again: true until a resize handle is dragged, and the
panel's Auto size toggle is the way back, because nothing else returns a box to fitting its
contents and a one way door is not a setting.

A component that declares a `defaultWidth` in the registry is laid out **by** its width and its
height follows; one that does not is measured at its natural size on both axes. Asking a button
to be 400 wide is a resize, not a measurement.

### The registry, which is generated from the source rather than written

`apps/editor/src/components/registry.tsx` is the only place that knows a key names a React
component, and it no longer holds a list. It used to: three components, each with its props,
their kinds, their options and their defaults, all hand maintained. Every one of those facts
is already stated in the component's own signature, and two records of one fact drift. A
variant added to `ButtonVariant` showed up in TypeScript, in autocomplete and in the
component's behaviour, and nowhere in the panel offering it.

So the library is read off disk. The Vite plugin in `apps/editor/vite-plugins/` parses the
component folder and serves the result as `virtual:component-library`, which carries both
halves: the description as data, and the modules through an `import.meta.glob` in the emitted
source, so Vite owns loading and React Fast Refresh keeps working. **Adding a prop to a
component's type adds a field to the properties panel, on save, with no reload and no
registration anywhere. So does adding a whole component file.**

**The glob is emitted by the plugin rather than written in the registry, and that is what makes
a new file appear.** A glob is expanded when its module is transformed, and a glob written in
`registry.tsx` could never be expanded again: that module accepts the virtual one as a hot
dependency, and Vite deliberately does not invalidate an importer that accepts the module which
changed, so the description would gain a component and nothing would be behind it. Emitting the
glob into the virtual module means the thing being invalidated is the thing the glob is written
in. It also means the two halves arrive together, which two separate modules could not
guarantee.

The hook is `hotUpdate`, not `handleHotUpdate`, and that is not only a deprecation: Vite calls
the older one for `type === 'update'` alone, so a created or deleted file reached no plugin at
all and adding a component did nothing until the dev server was restarted. A delete is the one
case that returns the virtual module **instead of** the modules Vite worked out rather than
alongside them, because those are the file that has just gone and asking the client to fetch
them is a failed reload. Dropping them is also the whole behaviour: the glob re-expands without
the component, the registry drops the spec, and a node still naming it falls back to the
placeholder an unknown key already gets.

Three things follow from that, and they are the point of it:

- **A union of string literals is a dropdown.** `variant?: 'primary' | 'secondary'` is a closed
  set, so the panel offers exactly those and a typo cannot reach the component.
- **A default comes from the destructuring**, `function Button({ label = 'Button' })`, because
  that is where a React component actually states what it does when it is told nothing. A
  default written anywhere else is deliberately not chased: the panel would then promise
  something the signature does not.
- **A prop the document cannot store is dropped rather than given a control.** The document
  holds scalars, so a control for a callback or an element would be offering to write a value
  that could not be saved, loaded or undone. The prop is real and the component keeps doing
  whatever it does with it.

**The parse uses a real type checker, and that is the whole reason it is a compiler rather than
a regex.** `variant?: ButtonVariant` says nothing on its own, and a real component writes
`import type { ButtonProps } from './types'` or intersects with `HTMLAttributes`. Resolving
those is what a checker is for. Note it is TypeScript 5, pinned separately under an alias:
TypeScript 7 is the native port and ships no JavaScript compiler API, so there is nothing to
call. It runs in the dev server and the build, never in the browser, and the Node and browser
halves are separate compiler programs (`tsconfig.node.json`) so neither can reach into the
other. What they do share is `libraryTypes.ts`, which has no imports at all, because it is a
wire format rather than a module.

Two things a component still declares for itself, in its own file:

- `export const canvasDefaults = { width: 220 }`, when the component is laid out by its width.
  Whether a field fills the room it is given is a fact about the field, so it belongs beside
  it rather than in a table somewhere else.
- Everything else about how it looks and behaves, which was always true and is now the only
  thing left.

The render adapter stays, generated per component: it is the boundary where the document's
scalars become typed props, and where a variant a saved file names but this build no longer
has falls back rather than reaching a component that has no reason to expect one. An unknown
key is still a real answer, not an error: the layer draws a placeholder where the node sits,
because losing it would silently edit someone's document on load.

**A source change is not an edit anyone performed.** Editing a component resizes every instance
of it, so the measurements are dropped and taken again, inside a history group that is aborted
rather than committed: the writes land on the live document and no step reaches the undo
stack. That is the same primitive a cancelled drag uses. It runs more than once as the update
settles, because a hot update applies the description of the library and the component's own
module independently and Fast Refresh debounces its re-render, so the first look can measure
the component that is being replaced. Looking again is free when nothing changed: a
measurement equal to what the node already holds produces no patch, no version bump and no
redraw.

### Dropping, and why it is a semantic operation

The panel starts a native HTML5 drag, and the canvas answers `dragover` and `drop`. Native,
because the gesture crosses two elements that know nothing about each other and the platform
already owns the drag image, the cursor and the escape key. What is being dragged is a module
level value rather than something read back off the `DataTransfer`, because the platform hides
a drag's data until it is dropped and the preview rectangle needs the size on every move. That
preview is drawn by the **overlay pass**, since drag feedback is screen space furniture in
exactly the sense the marquee is.

Where it lands depends on what it lands on, and the difference is the point:

- A plain frame is positional, so the component is centred on the drop point.
- An **auto layout frame is not**. The point becomes an `insertionIndex` and the layout decides
  the coordinates. Writing a transform there would be inventing a position the very next
  layout pass overwrites, and it is the difference between a component that joins a stack and
  one that merely lands on top of it.

Dragging a component that is already in a stack reorders it through the same `applyFlow` a
shape goes through, so none of this is a second code path.

### Virtualization

An artboard whose components are more than half a viewport outside the view is unmounted, on
the same margin and for the same reason the instance buffer culls with one: unmounting at the
exact edge would rebuild a whole React tree, and lose everything typed into it, on a pan that
barely moved. The visible set is recomputed on camera and document changes and only ever
replaced when it actually differs, so a drag that changes nothing re-renders nothing.

### What this arrangement cannot do

A component always paints above every GPU shape in its frame, whatever the z-order says,
because the two live in different planes and only one of them is a compositing layer. Sending
a component to the back of a frame reorders it for auto layout and for the layers panel, and
does not put it behind a rectangle. Interleaving would need a surface per z-run.

## The code panel

The right hand column has two faces, and they are two renderings of one fact: what the
selected node is set to. Properties is what it is; Code is what that would be written as. They
share a column rather than sitting side by side, because otherwise you would have to choose
which of two panels about the same node to read.

**Code is a property of the selection, not a document you open.** That is the whole premise,
and it is what decides everything else here. There is no file tree, because a design tool
navigates by clicking the thing rather than by finding its file.

### Two levels, which are two different kinds of thing

**The call site** is printed from the node's props, so it is a view of the **document**. Change
a prop in the properties panel and the JSX rewrites itself. **The component's own source** is
read from disk through the dev server, so it is a view of the **file**. Keeping them visibly
apart is the job of the panel's chrome, because they are about to have different write paths:
one edits the document, the other edits the repo.

Descending is the gesture a design tool already has for going from an instance to its main
component: double click on the canvas, or Enter with it selected, which is the same double
click that descends into a text node's characters. Escape comes back. Selecting anything else
leaves the file, because a panel that kept showing a file after you selected a rectangle would
stop being about the selection, and that is the one thing that makes it readable with no mode
indicator.

The printer omits a value equal to the component's own default, so a freshly dropped Button
prints as `<Button />` rather than four attributes restating the signature. Two rules meet on
booleans and the order matters: turning off a prop the component already defaults to off says
nothing and is omitted, while turning off one it defaults to on is a real choice with no
shorthand, so it prints as `collapsible={false}`.

One thing the panel has to admit and does, in a line under the code: **the printed call site is
not the whole call site.** The document stores scalars, so a prop typed as a callback or an
element never reaches it and cannot be printed. Without saying so the panel would read as
complete while quietly being partial.

### Editing the call site, which writes the document rather than a file

The call site is editable in the same field, and committing it goes through
`replaceComponentProps`, which **assigns rather than merges**. That distinction is the whole
of it: the properties panel says one thing about one prop and nothing about the others, so a
merge is right there. A tag is the whole statement, so an attribute that is not there is a
prop that is not set, and a merge would keep it and quietly disagree with the code that was
just committed.

What follows from that, and is worth expecting: committing drops every prop equal to the
component's own default, since the printer left those out and the tag therefore does not claim
them. Nothing moves on screen, because the component falls back to the same value. What
changes is which one is the source of it, and that is the right way round: the instance now
follows the component's default if the component's default moves.

`parseInstance` is a small hand written reader rather than a parser dependency, because the
input is one self closing tag of scalars and the browser bundle has no TypeScript in it. Two
rules run through it, both about not half applying an edit: it never throws, and it never
returns partial props, so a tag with four good attributes and one bad one is an error rather
than four props. Nothing is coerced either: `count="3"` is a refusal, not the number three,
because the component's type is what the panel exists to respect. A value outside a union is
the case that pays for the whole approach, since a closed set is only closed if something
checks.

The round trip is the test that keeps the two halves honest, and it is deliberately **not** an
identity on props: printing drops a default, so what comes back is what was actually chosen.

A commit is one undo step, because it goes through the same measured transaction the panel's
own fields do. A call site draft is deliberately **not** parked the way a source file's is: a
file draft has no other representation anywhere, while a call site is a rendering of props
that are still in the document and stops meaning anything the moment a different node is
selected. So it survives a tab switch, which is the same node, and not a selection change,
which is not.

### Reading a file, and what the endpoint refuses

`GET /__component-source?file=...` is the first thing in the project that lets the browser
reach the repo, so the design is mostly about what it will not do.

It is **dev only by construction**: it lives on its own Vite plugin carrying `apply: 'serve'`,
so it does not exist in a build to be reached. Its own plugin rather than a hook on the
library one, because that plugin also serves `virtual:component-library`, which the production
build needs. The client half is behind `import.meta.env.DEV`, which is statically false in a
build, so Rollup drops the whole path and the route string is not in the bundle.

`resolveLibraryFile` is the guard, pure and tested on its own. Every rule has to pass: no null
byte, resolve before comparing, `.tsx` only, **the file resolved through symlinks**, its real
directory exactly the library, and it must already exist. The symlink rule is the one that is
easy to get subtly wrong, and getting it wrong is how this reads any file on the machine:
resolving only the containing directory lets a link sitting inside the library point anywhere
at all, because the directory is the library and the link is never followed. The test for
exactly that caught it here. The match is exact rather than a prefix, because the library is
scanned one level deep and because a prefix test for `library` also accepts a sibling named
`library-secrets`.

A refusal is a bare 403 that never echoes the path back, so it cannot be used to ask whether
a file exists.

### Writing a file, which is mostly about what a save is measured against

`POST /__component-source` carries `{ file, text, mtimeMs }` and passes every check the read
does plus two of its own.

**The stamp is a precondition, not a record.** It is the `mtimeMs` the read handed over, and
the file is written only if that is still what is on disk. A mismatch is a 409 rather than a
write, so an edit made in an ordinary editor while the panel held the file is a refusal instead
of whichever save landed last silently winning. Nothing is coerced on the way in: a `mtimeMs`
sent as a string would compare unequal to every number on disk and turn every save into a
conflict, which is a far more confusing failure than a refusal to parse.

**The write lands through a temporary file and a rename**, because a rename within one
directory is atomic and a reader therefore sees the old file or the new one and never half of
one. That matters more here than in an ordinary editor, since this file is watched: a partial
write is parsed, fails, and takes every instance of the component off the canvas. The temporary
name deliberately does not end in `.tsx`, so both the library scan and this endpoint's own
guard ignore it while it exists.

The body is capped at 512 KB and refused **as it arrives** rather than after it lands. The
request is paused rather than destroyed at that point, because destroying it takes the socket
and the 413 with it, and the client would see a dropped connection instead of the reason.

**Cmd+S commits, and blur deliberately does not.** Every other field in this editor writes on
blur, and this one must not: it writes to your repo, and clicking away from a file is not a
decision to save it.

**An unsaved edit outlives the panel** (`code/drafts.ts`). Selecting anything else leaves the
file, which is the rule that keeps the panel about the selection with no mode indicator, and
without a parked draft that rule would also discard whatever had been typed, on an ordinary
click on the canvas. The base travels with the draft, because it is what the edit was measured
against: leaving and coming back has to leave a stale save a refusal rather than an overwrite,
exactly as staying would have. It is a module map rather than store state because nothing else
reads it and a keystroke should not wake a subscriber, and it is emphatically not in the
document, because a file is not part of the scene and must not reach a save, a history step or
a collaborator.

A library change re-reads the file, and that re-read is **skipped while there are unsaved
edits**. Replacing the field with what is on disk is exactly the loss the precondition exists
to prevent, and keeping the old base is what makes the next save a refusal.

A file edit is not a document edit, so it touches no history: `isEditingText` already makes
every window level shortcut stand down while the field has focus, so Cmd+Z inside it is the
browser's own textarea undo and the scene's undo stack is untouched.

## Rotation, and the one rule it added

`SelectionBox` is an upright rect plus an angle, not four corner points. Everything asking where
something is on the box maps the point in through `toBoxSpace` first, so `handleAt`, `handlePoints`
and the overlay all kept the axis aligned code they already had and gained rotation for free.

**A single selection carries its own basis; a multiple selection collapses to upright.** Two nodes
at different angles have no shared basis, and that one rule decides three separate things: the box
that is drawn, the box that is grabbed, and the frame a resize happens in. They agree because they
all ask the same question.

That is why resize has two paths. A single node resizes in its own frame, so dragging its east
handle lengthens it along its own x axis however it is turned. The pure functions are the same
ones the world aligned path uses, handed the node's local box and the pointer mapped into local
space instead. Growing `size` always grows away from the local origin, so holding an anchor still
means shifting the origin by `anchorLocal * (1 - scale)`, put through the transform's linear part
to land in the parent's units. A multiple selection keeps the world aligned path.

Rotation composes in world space and maps back through the inverse parent world. Adding to a
node's local transform would be wrong for anything inside a rotated or scaled frame, since its
local units are not the ones being turned.

During a drag the rotation applied each frame is **absolute from the grab**, never accumulated.
An incremental delta could not walk an angle back down, which is exactly what has to happen the
instant shift is pressed mid gesture.

The pivot differs by gesture on purpose. Dragging the handle turns one node about its own centre
and a group about the centre of its bounds, so a group swings together. The panel's angle field
turns every node about its own centre, because typing 30 into a row means each in place rather
than sweeping them into an arc.

Clicking selects the deepest node under the cursor, so a rectangle inside a frame selects the
rectangle. Figma selects the outermost frame and makes you double click to descend. That is a UI
policy rather than a geometry question and it lives above `hitTest`, which is why the function
returns the deepest hit and lets the caller decide.

## Planned work lives in TASKS.md, not here

**This file does not list future work.** It describes what exists and why it is built the way it
is. Planned and in progress work lives in `TASKS.md`, at the root of the repo.

Two records that both claim to say what is left will drift within a week, so they are split by
job: `TASKS.md` owns status, this file owns architecture. When something ships, describe it above
and check it off there.

A few things are worth knowing because the code looks finished but is not:

- Clipping is honoured per pixel but not yet used to cull. A subtree entirely outside its clipping
  frame is still walked and packed, only to be thrown away by the fragment shader. Skipping it
  would be a real win on a deep document and would also make the `culled` figure in the perf
  readout a lie unless the skipped instances are counted some other way.
- The selection box and the resize handles follow the node's `size`, so an outward stroke sits
  outside them. That is deliberate, because the handles edit `size` and have to line up with what
  they change, but it does mean the box is not the drawn bounds.
- Resizing a **multiple** selection that contains a rotated node still works along world axes, so
  a turned node in the group is stretched rather than scaled along its own edges. Figma skews
  nothing and neither does this, but the result is not what the handles imply.
- A resize cannot flip a node through its anchor. `scaleFactors` clamps positive, because a
  negative scale needs the SDF and hit testing to agree on what an inside out shape is.
- The accent colour is hardcoded in `OverlayInstances` because the renderer has no access to CSS.
  It needs passing in when the theme toggle exists, since dark uses a lighter blue.
- A component node always paints above every GPU shape in its frame, whatever the z-order says.
  The two live in different planes and only one of them is a compositing layer, so sending a
  component to the back reorders it for auto layout and for the layers panel without putting it
  behind a rectangle.
- The drop preview drawn while a component is dragged in is the component's own box under the
  pointer. Over an auto layout frame the component will actually land in a slot, so the preview
  says what is coming rather than exactly where.
