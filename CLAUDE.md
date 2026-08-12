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

## Commands

```
pnpm dev         editor on :5173
pnpm build
pnpm typecheck   every package
```

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

Drawing is on demand, not a permanent `requestAnimationFrame` loop. `CanvasHost` redraws on
resize and on document change, coalesced into one frame. An editor is static most of the time and
a loop running at 120Hz over a still document burns battery producing identical pixels.

The instance buffer rebuilds only when `document.version` changes, so it is untouched by panning.
Shapes are packed back to front and blended in that order, which is why there is no depth buffer:
overlapping translucent shapes need painter's order and a depth test would discard their blending.

- Hit testing (`packages/document/src/hit.ts`) and drag (`apps/editor/src/input/pointerInput.ts`).
  Hit testing uses the same rounded box distance function as the fragment shader, so what you can
  click is exactly what you can see, corner radius bites included. Input reads the stores through
  `getState` rather than subscribing, because a drag must not put a React render between the
  pointer and the pixels.

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

Not built yet, and deliberately so:

- Strokes. `Stroke` exists in the document and nothing reads it. The SDF makes this cheap when it
  comes: an outline is `abs(d) - weight / 2`.
- Selection handles, and anything that draws in screen space rather than world space. Selection is
  currently visible in the layers panel only.
- Marquee selection, resize, rotate, and the shape tools actually creating anything.
- Input: hit testing, drag, marquee, the tools actually doing anything.
- Undo. Nothing about the current store shape assumes a particular approach, and command pattern
  versus snapshot versus CRDT is a real fork worth deciding before the renderer hardens.
- Text, images, boolean ops, auto layout, components, multiplayer.

When the WebGPU backend lands it is exported from `packages/renderer/src/index.ts`, created inside
`CanvasHost`, and nothing above that file changes.
