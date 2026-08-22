# Tasks

Planned and in progress work for figma-canvas. `CLAUDE.md` owns architecture, this file owns
status: two records that both claim to say what is left will drift within a week, so they are
split by job. When something ships, describe it in CLAUDE.md if it's worth knowing later, and
check it off here with a one-line note (`file:line`, what landed).

## Polish pass

Rotation (days 7-9) just wrapped. This pass was chosen over the other two deferred candidates,
snapping and text, and covers UX rough edges found across the editor: missing keyboard shortcuts,
missing hover/focus/cursor states, and a few panel-field edge cases.

Keyboard (`input`)
- [x] Cmd/Ctrl+A selects all nodes. `apps/editor/src/input/keyboardInput.ts`
- [x] Escape clears the current selection. `apps/editor/src/input/keyboardInput.ts`
- [x] Arrow-key nudge, 1px / Shift 10px, one undo step per held-key burst, with a window blur
      safety net. `apps/editor/src/input/keyboardInput.ts`

Pointer (`input`, `document`)
- [x] Grab/grabbing cursor for the hand tool and space-held pan. `apps/editor/src/input/pointerInput.ts`,
      `apps/editor/src/canvas/CanvasHost.module.css`
- [x] Escape cancels an in-progress drag (move/resize/rotate/marquee/create). New
      `SceneDocument.abortHistoryGroup()` in `packages/document/src/document.ts`, wired into
      `apps/editor/src/input/pointerInput.ts`
- [x] Zoom-to-fit (Shift+1) and reset-to-100% (Shift+0 / Cmd+0). `apps/editor/src/canvas/CanvasHost.tsx`

Panel fields (`ui`)
- [x] Normalize the angle field on commit. `apps/editor/src/ui/PropertiesPanel.tsx`
- [x] Clamp W/H fields to the resize floor. `apps/editor/src/ui/PropertiesPanel.tsx`, reuses
      `MIN_NODE_SIZE` exported from `apps/editor/src/input/resize.ts`
- [x] Arrow-key increment/decrement in NumberField. `apps/editor/src/ui/NumberField.tsx`
- [x] Editable hex value in ColorField. New `parseHex` in `packages/document/src/paint.ts`,
      `apps/editor/src/ui/ColorField.tsx`

Layers panel (`ui`)
- [x] Shift/Cmd-click multi-select on layer rows. `apps/editor/src/ui/LayersPanel.tsx`
- [x] Enter/F2 triggers rename on a focused row. `apps/editor/src/ui/LayersPanel.tsx`

Accessibility (`ui`)
- [x] aria-live on the FileActions import error. `apps/editor/src/ui/FileActions.tsx`

## Panel polish pass

Both React panels, visual refinement plus missing states, split across two parallel agents.

- [x] Layers: fold chevrons (session-only UI state), lock toggle per row, empty state, visual
      pass. `apps/editor/src/ui/LayersPanel.tsx`, `uiStore.ts` (collapsed set), `icons.tsx`
      (Chevron/Locked/Unlocked). Drop-into a collapsed frame auto-expands it.
- [x] Properties: "N selected" multi-select state, empty state, labeled sections, visual
      pass. `apps/editor/src/ui/PropertiesPanel.tsx` and the field module.css files; shared
      5px text inset, unit suffixes on angle and opacity, clip toggle folded into Appearance.

## Text

A text node that draws on the GPU, with inline editing and fixed width boxes. All six phases
have shipped.

- [x] Inter 4.1 Regular vendored under OFL, baked to a 512x512 MSDF atlas with msdf-atlas-gen.
      203 glyphs, Latin-1 plus typographic punctuation. `packages/renderer/src/font/`, with the
      exact bake command and every flag's reason in its `README.md`.
- [x] `parseAtlasMetrics` refuses a bad bake rather than trusting our own build output, since a
      re-bake without `-yorigin top` renders happily upside down.
      `packages/renderer/src/font/metrics.ts`
- [x] `TextNode` with `characters` and `fontSize`; `size` is the measured bounds, cached.
      `packages/document/src/node.ts:66`
- [x] Layout, measurement and caret maths, all pure and font-injected.
      `packages/document/src/text/layout.ts`
- [x] Hit testing on the layout bounds. `packages/document/src/hit.ts:36`
- [x] `SCHEMA_VERSION` 2. Version 1 files still load; the bump is so an older build refuses a
      version 2 file by version rather than on an unknown node type. `packages/document/src/serialize.ts:17`
- [x] Glyphs pack into the existing 80 byte shape instance as `kind = 2`, reusing the slots a
      letter has no use for. Still one pipeline and one draw call, so text keeps its place in
      paint order among the shapes. `packages/renderer/src/webgpu/ShapeInstances.ts`
- [x] MSDF sampling in the shape shader, with every derivative hoisted above the branch.
      `packages/renderer/src/webgpu/shaders/shape.wgsl`
- [x] The atlas as the app's first texture and sampler, at `@group(2)`.
      `packages/renderer/src/webgpu/GlyphAtlas.ts`
- [x] Text tool, and the app's first tool shortcuts: V H F R O T.
      `apps/editor/src/input/keyboardInput.ts`, `apps/editor/src/ui/Toolbar.tsx`
- [x] Inline editing through an invisible textarea, with the caret and the selection highlight
      drawn by the overlay. `apps/editor/src/ui/TextEditor.tsx`
- [x] A typing burst is one undo step, with a blur safety net.
- [x] Click and drag inside text to place and extend the caret; double click to re-enter.
      `apps/editor/src/input/pointerInput.ts`
- [x] Text nodes remeasure when the font arrives, so a loaded file is not stale.
      `apps/editor/src/state/font.ts`
- [x] No resize handles on a text node, since its bounds follow its text. Rotate stays.
      `packages/renderer/src/selection.ts`

- [x] A Text section in the properties panel with the font size, W and H reporting rather than
      offering an edit, and the Stroke section gated off for text. New `readOnly` variant on
      `NumberField`. `apps/editor/src/ui/PropertiesPanel.tsx`
- [x] A layer row reads a text node's own first line until it is renamed, and renaming starts
      from that. `apps/editor/src/ui/LayersPanel.tsx`
- [x] The architecture written up in `CLAUDE.md`, including a correction: clearing
      `figma-canvas:document` does not restore the seed, because the `pagehide` flush writes
      the live document back first.

- [x] Fixed width boxes. `autoWidth` on the node, greedy word wrapping in `layoutText`, and the
      east and west handles turning a box fixed width when dragged. `SCHEMA_VERSION` 3, with the
      first real migration: a version 2 text node predates the field and reads as auto width.
      `packages/document/src/text/layout.ts`, `packages/renderer/src/selection.ts`
- [x] An Auto width toggle in the properties panel, so the conversion is not one way, and W
      becomes editable once a box is fixed width. `apps/editor/src/ui/PropertiesPanel.tsx`
- [x] One shared `TextLayoutCache` instead of a private one in the packer, so a keystroke lays
      the node out once rather than three times and an idle caret blink not at all. Owned by
      the editor and passed to the renderer through `RendererInit`; the instance buffer's
      rebuild is what ages it. `packages/document/src/text/layoutCache.ts`
- [x] The character mangling is found and fixed. The layout effect in `TextEditor` pushed the
      store's caret back into the textarea on every keystroke, but typing is a discrete event
      and `selectionchange` is queued, so the caret it wrote was the one from before the
      character. That pinned the caret at offset zero and typed `abc` as `cba`. The caret is
      now written only when it moved from outside the field. `apps/editor/src/ui/TextEditor.tsx`

Deferred, and deliberately not in the MVP:

- [ ] Weight and italic, which need more atlas pages
- [ ] Alignment, letter spacing, line height control
- [ ] Text stroke. The node carries `strokes` because every painted node does, but nothing
      draws them, and `containsPoint` deliberately does not grow the hit area for them either
- [ ] Kerning. Inter keeps its pairs in GPOS and the generator only reads the legacy `kern`
      table, so the baked atlas has none. Real kerning needs proper shaping
- [ ] Non-Latin text, a tofu glyph for uncovered code points (Inter has no U+FFFD, so the
      fallback is a question mark), and a second atlas page added at runtime
- [ ] RTL and complex shaping
- [ ] Word and line selection on double and triple click inside text
- [ ] Auto height, the third sizing mode: a fixed width and a fixed height, with the text
      clipped or shrunk to fit rather than growing the box
- [ ] Rich text: more than one style in a node
- [ ] Plain text pasted onto the canvas becoming a text node

## Auto layout

Figma-style auto layout: frames that lay their children out in a row or column. The core set
has shipped; the engine is pure and lives in the document package, invocation is push-based
from every mutation site.

- [x] `FrameLayout` on frames (direction, gap, per-side padding, main and cross alignment,
      hug/fixed per axis) and `LayoutChild` on every node (fixed/fill per axis).
      `packages/document/src/node.ts`, with both deep-copied in `cloneNodeAs`.
- [x] The engine: pure, DOM-free, measurer-injected like text layout. Resolves each child
      once with its final constraints, epsilon-compares every write so a settled document
      produces zero patches. `packages/document/src/layout/autoLayout.ts`
- [x] `SCHEMA_VERSION` 4. Absence means no layout, so version 3 files need no migration and
      an older build refuses a version 4 file by version. `packages/document/src/serialize.ts`
- [x] Push invocation: `relayout` called inside the same transact as every mutation that can
      disturb a layout, so one edit is one undo step and undo never runs layout.
      `apps/editor/src/state/autoLayout.ts`, wired into delete/cut/paste/duplicate, layer
      drop, z-order, updateText, remeasureAll, load, visibility toggle, resize, rotate, nudge.
- [x] Panel: Auto layout section on frames (add/remove, direction, gap, padding X/Y,
      alignments), Hug toggles in Size, Fill toggles on children of auto frames, X/Y and
      derived axes reporting readOnly. `apps/editor/src/ui/PropertiesPanel.tsx`
- [x] Shift+A toggles auto layout on a single selected frame; enabling infers direction, gap
      and padding from where the children sit, so nothing moves.
- [x] Shift+A on anything that is not a single frame (a text node, a shape, a multiple
      selection) wraps it in a new auto layout frame drawn 10px around the selection, so
      the padding starts at Figma's default 10; hug on both axes, no clip, no fill.
      `wrapInAutoLayout` in `apps/editor/src/state/autoLayout.ts`.
- [x] Canvas reorder drag: a single child of an auto frame floats with the pointer, siblings
      shift live around an excluded slot, leaving the frame un-parents live, release snaps
      in, Escape restores parent, index, transform and siblings exactly.
      `apps/editor/src/input/pointerInput.ts` (`applyFlow`)
- [x] Dragging a handle claims its axes: a hug axis flips to fixed, a child's fill axis
      flips to fixed, both restored by Escape.
- [x] Arrow keys on an auto child step it through the flow along the main axis; cross-axis
      arrows do nothing.

Deferred, deliberately:

- [ ] Wrap, min/max sizes, absolutely positioned children, negative gap
- [ ] Per-side padding editor (the model already stores four sides)
- [ ] Insertion indicator line while reorder-dragging (the siblings shifting is the current
      affordance)
- [ ] Reorder drag for multiple selections (falls back to drop-on-release)
- [ ] `space-between` has no icon treatment, only the Space segment

## Design panel parity

Gaps found comparing the Design (properties) panel against Figma's own, 2026-08-22. Position,
size, opacity, single fill/stroke, and auto layout's row/column with gap/padding/alignment
already have a working equivalent and are not listed again here.

Position
- [ ] Align/distribute: align selection to left/center/right and top/middle/bottom, relative to
      the parent frame or to the selection's own bounds. No command for this exists yet, only
      z-order (`apps/editor/src/state/order.ts`).
- [ ] Flip horizontal / flip vertical. Rotation exists (`setNodesAngle`,
      `apps/editor/src/state/rotate.ts`) but a flip is a different operation, not just a 180
      degree turn, and nothing implements it.
- [ ] Move the angle field out of Appearance into its own Rotation subsection under Position,
      next to the new flip icons. `apps/editor/src/ui/PropertiesPanel.tsx:206`

Auto layout
- [ ] Grid flow mode, alongside the existing row/column. Wrap is already tracked separately in
      the Auto layout backlog below; grid is a distinct third mode.
- [ ] Baseline alignment option in the cross-axis align control.
      `apps/editor/src/ui/PropertiesPanel.tsx:357`
- [ ] Collapse the Hug width/height checkboxes (`PropertiesPanel.tsx:139`) and the Fill
      width/height checkboxes (`:169`) into one Hug/Fixed/Fill dropdown per axis, docked in the
      Auto layout section itself rather than split across Size.

Appearance
- [ ] Independent per-corner radius, with a toggle to switch a single `R` field into four.
      Model only stores one `cornerRadius` scalar today (`packages/document/src/node.ts`), so
      this needs a model change, not just a panel change.
- [ ] Blend mode control (the opacity row's droplet icon in Figma). No blend mode field exists
      on any node.

Fill / Stroke
- [ ] Multiple paints per node, not just `fills[0]` / `strokes[0]`. Already a known gap in
      `CLAUDE.md`; listing here because it is also the reason there is no per-paint list UI.
- [ ] Gradient and image paint types. `Paint` is solid-color only today
      (`packages/document/src/paint.ts`).
- [ ] Per-paint opacity, blend mode, and visibility toggle on each fill/stroke row.

New sections
- [ ] Effects (shadow, blur): model, renderer support, and a panel section. Nothing here draws
      an effect today, only fills and strokes.
- [ ] Selection colors: a read-only summary of every color used across the current selection.

Panel chrome
- [ ] Header row controls: node-type dropdown, a code/inspect icon, a "make component" icon, and
      a "..." overflow menu. The type-dropdown and overflow menu are panel-only work; the code
      icon (dev mode) and component icon depend on features not in scope yet (no dev-mode
      inspector, no component/instance model), so those two are blocked on larger work, not a
      quick add.

## Backlog

Deferred from the panel polish pass:

- [ ] Properties multi-select: editable shared fields with per-field Mixed detection, batch
      commit through one transact

Deferred when rotation was picked as the day 7-9 direction:

- [ ] Snapping: to guides, edges, and other shapes during drag/resize

Known gaps noted in CLAUDE.md as deliberate, not yet built:

- [ ] Only `fills[0]` and `strokes[0]` are read; no multi-paint stacking
- [ ] `clipsContent` clips per pixel but doesn't cull subtrees outside their clip yet
- [ ] Multi-selection resize on a rotated node scales along world axes, not its own
- [ ] Accent colour is hardcoded in `OverlayInstances`, needs to come from theme
- [ ] No spatial index; the 10k-node walk is the next real perf lever
