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
into one step: oldest before, newest after. The input layer opens the group on the first move past a
few pixels of slop rather than on pointer down, so a click leaves nothing behind.

**The slop is not only about history.** The test it replaced was an exact comparison, which is the
only kind available: half a pixel of tremor between pointer down and the first move is a real
difference, so every press was a drag. A drag that has begun pulls its node out of the auto layout
flow so it can float, which is right once the node has visibly detached and wrong while it is
still sitting where it was, because the siblings close up over it and stay there for as long as
the button is held. Resize and rotate wait on the same slop, since a press on a handle that never
moved must not flip a hug axis to fixed or turn a node by a fraction of a degree.

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

Tests sit next to what they cover as `*.test.ts`. Vitest resolves the `@canvas/*` imports
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

- Gradient paints, linear and radial. `Paint` was already a union, so the type slotted in;
  what stops cannot do is fit in an instance, being variable length, so they live in a second
  storage buffer at `@group(1) @binding(1)` beside the clip table, following the `ClipRegions`
  precedent (`GradientRamps.ts`). A gradient is a header record and its stops as a contiguous
  stream of 8 float records; the instance carries the header's index in `params.x` (`-1` for a
  solid) and bit 0 of the `flags.w` bitfield. The two points live in the node's 0..1 box space,
  so a gradient survives a resize untouched, and the shader samples with `in.local / in.size`
  rather than the padded quad position, so a gradient on a stroke ramps across the node, not
  the band. The stop walk mixes through the list with each step clamped, which evaluates the
  piecewise ramp exactly and bounds the loop the way `MAX_CLIP_DEPTH` does; the parser refuses
  more than `MAX_GRADIENT_STOPS` and sorts on the way in, making stop order an invariant. The
  instance's colour slot still carries the first stop with the inherited alpha alone, so the
  slot means something on every instance and the stop's own alpha composes in the shader. The
  two tables share one bind group, which neither can own since either buffer growing
  invalidates it: the renderer memoises it on the buffers' identities. Since both tables need
  the group, growing either is watched per frame rather than signalled. Glyphs have nowhere to
  put an index, their spare slots being atlas coordinates, so a gradient fill on text draws as
  its first stop.

- Drop shadows, as `effects: DropShadow[]` on the box nodes: optional with absence meaning
  none, so old files need no field, and a list so a second shadow later is not a schema
  change. Text deliberately has no `effects`, because a glyph's coverage comes from the atlas
  rather than the box SDF and a text shadow is a different feature; the type system is the
  guard. A shadow is a third instance kind beside fill and stroke, emitted before the fill so
  painter's order puts it behind the node and over what the node sits on: same size, same
  radii, bit 1 set, blur and spread in the two `flags` slots a box never used, and coverage is
  the same signed distance pushed out by the spread and smoothed over the blur, so there is no
  second pass, no offscreen target and no kernel. A zero blur falls through to the sharp
  coverage path, since `smoothstep` with equal edges is undefined, which is also what makes a
  spread-only shadow a clean glow. **The offset rides in the instance's transform, not the
  quad padding**: both padding computations assume uniform four-side padding, and the offset
  is directional, so it is folded through the world's linear part instead, in the node's own
  units, turning and scaling with the node. `hit.ts` deliberately does not grow for a shadow
  and neither do the selection bounds, matching Figma: `strokesOutset` stays the only thing
  that widens what a click can reach.

- Schema version 6 covers both. Not for migration, since absence means the same thing in a
  version 5 file, but so a build from before either feature refuses a version 6 file rather
  than silently dropping fills and shadows and then overwriting the save without them.

- Premultiplied alpha out of the shape shader, with `one / one-minus-src-alpha` on both colour and
  alpha. Byte identical to straight alpha here, because the surface is `alphaMode: 'opaque'` and
  the pass clears to `a = 1`, so destination alpha is 1 for the whole pass and the two agree. It
  is a prerequisite rather than a fix: every blend mode other than source over reads the colour
  channels directly, and a straight alpha source would draw a dark fringe along every antialiased
  edge.

Drawing is on demand, not a permanent `requestAnimationFrame` loop. `CanvasHost` redraws on
resize and on document change, coalesced into one frame. **A resize is the exception that draws
synchronously.** A `ResizeObserver` callback runs after layout and before paint, so the element
already has its new box by the time it fires, and scheduling the redraw would present one frame
of the old texture stretched into it. The side panels are grid columns rather than an overlay, so
dragging one resizes the canvas on every pointer move and that stretch is every frame of the
gesture: the drawing appears to squash and spring as the panel moves. Reconfiguring the surface
also clears it, which is the other half of why the redraw cannot wait.

**A resize also moves the camera, so that the drawing does not move.** `camera.x` is the world
point at the *centre* of the viewport, so narrowing the canvas moves the centre and the same
camera puts the same world point somewhere else on the display: nothing about the view changed
and everything in it slides. `keepAnchored` in `camera.ts` corrects for it, and takes the
canvas's page rect rather than its size because where the canvas sits counts too. Widening the
left panel moves the canvas right and narrows it by the same amount, and those pull opposite
ways; correcting for the width alone would cancel half the slide and double the other half. It
falls out of holding a world point's page position across the change, and the world point drops
out of the algebra, which is the point: every point is held rather than a chosen one. A window
resize goes through the same rule and gets what a canvas should do, the drawing anchored where
it was and the new room appearing at the edge that grew. An editor is static most of the time and
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

  Hovering outlines what a click would select: the same four edges, from the same
  `selectionBox` and the same single push, with none of the handles. That last part is the
  decision rather than an omission. A corner square, an edge square and the rotate stem are
  affordances for a gesture, and offering them to a pointer that has not selected anything
  yet would promise a resize where a click only selects. What it outlines is the **resolved**
  target, Cmd included, since an outline that named the deepest node while the click took its
  frame would be worse than no outline at all. It is off over a handle, off under the hand
  tool and while space is held, off from pointer down until the release recomputes it, and
  skipped for a node already selected, whose own outline is exactly on top of it. The id
  travels in `ViewState` beside the marquee and lives in a `CanvasHost` ref rather than in
  the store, compared before it is written, so crossing a boundary costs one frame and moving
  within a node costs nothing.

  Selecting also **reveals the node in the layers panel**: every folded ancestor opens and the
  row scrolls into view. It matters more since clicks resolve up the hierarchy, because what a
  click lands on is often a frame's child rather than anything the pointer was literally over,
  and the tree is where you go to see which. Two effects rather than one, since the row the
  first unfolds does not exist until the render that unfolding causes. It only ever opens: a
  fold is the user's own state and closing it back afterwards would be taking it away.

  A resize starts anywhere along a side, not only on the midpoint handle, so the target is the
  whole perimeter the way it is in Figma. `handleAt` tests the handle points first and the edge
  bands after, which is what keeps a corner winning where the two overlap. The bands are derived
  from the same set the overlay draws, so both existing rules about that set carry over with no
  case of their own: a box too short for edge handles loses its bands with them and keeps its
  interior for dragging, and text, offering east and west alone, is grabbable along those two
  sides only.

- Text, as a node type, a pure layout, an MSDF atlas and an inline editor. It draws in the
  same instanced call as everything else. See the text section below.

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
the document and returns patches; it never writes. Like text layout it cannot measure text,
so a `TextMeasurer` comes in from the editor, registered by `state/font.ts` through
`setTextMeasurer` rather than imported, because importing the font module drags the atlas
fetch and the live scene into every test that touches a command module.

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
around an open slot. A hug axis holds the size it already has for as long as the frame has a
child out of the flow, because hug derives the frame from its children and dropping one would
otherwise shrink the frame itself, collapsing it the moment a drag began and springing it back
on release. It is scoped to the frame's own children rather than to the pass, so the frame a
node has just been dragged out of still shrinks live, and it is deliberately kept out of
`knownMain`/`knownCross`, which also decide whether a fill child stretches: fill against a hug
axis has to keep degenerating to fixed however the frame is sized. Entering a frame
reparents live, leaving hands the node to whatever is under the pointer, and the release runs one pass without the exclusion, which is what snaps
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

Clicking selects by hierarchy, not by depth. `hitTest` still returns the deepest node under the
cursor, because that is the geometry answer; what gets selected from it is a UI policy and lives
in `apps/editor/src/state/selectionTarget.ts`, above the document entirely.

The policy is Figma's. A click selects the outermost container the hit sits in, so a button made
of a frame, a rectangle and a label is one thing to click and drag. **A top-level frame is the
exception, and it is the whole reason this is not a walk to the root**: frames directly under the
page are artboards holding everything on the canvas, so one that swallowed its own clicks would
mean every selection started with a modifier. Selection stops one level inside them.

Two ways in, both in `pointerInput`: Cmd (or Ctrl) reaches the deepest node in one click, and a
double click descends one level. Descending is tried before text editing, so a double click opens
text only once there is nothing left to descend into, which is what lets the two share the gesture.

The level someone stepped into is remembered, as `context` in `uiStore`: clicking a sibling stays
at that depth instead of springing back out. It is view state in the purest sense, and it is
cleared by a click on empty canvas and by anything else that clears the selection. A context that
no longer contains the hit is stale, whether the node was deleted or the click simply landed
elsewhere, and resolving falls back to the default as if nothing had been entered. Picking a row
in the layers panel sets it too, since naming a node outright is the same statement Cmd clicking
it makes.

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
