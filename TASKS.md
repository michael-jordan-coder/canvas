# Tasks

Planned and in progress work for canvas. `CLAUDE.md` owns architecture, this file owns
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
- [ ] Grid flow mode. Deferred alongside Wrap and for the same reason: the main/cross closures
      at `autoLayout.ts:323-344` derive both axes from one boolean, so grid is a second `#solve`
      body rather than a third `LayoutDirection` threaded through. It also needs a 2D
      `insertionIndex` (`:128` is hard-wired to one axis) and a decision about whether
      `inferLayout` can ever infer a grid.
- [ ] Per-side padding editor (the model already stores four sides)
- [ ] Insertion indicator line while reorder-dragging (the siblings shifting is the current
      affordance)
- [ ] Reorder drag for multiple selections (falls back to drop-on-release)
- [x] `space-between` has an icon treatment: a toggle beside the Gap field, remembering the
      alignment it replaced so switching it off reverts. `apps/editor/src/ui/PropertiesPanel.tsx`

## Design panel parity

Gaps found comparing the Design (properties) panel against Figma's own, 2026-08-22. Position,
size, opacity, single fill/stroke, and auto layout's row/column with gap/padding/alignment
already have a working equivalent and are not listed again here.

Position

The commands exist and are tested; what is left in this block is the panel and keyboard wiring
that reaches them.

- [x] `alignSelection` for left/centerX/right/top/centerY/bottom plus distribute on both axes,
      mirroring `order.ts`'s shape and reusing `selectionWorldBounds` from the renderer package.
      A single node aligns to its parent's box, two or more to their own union. Locked nodes and
      auto layout children are skipped from moving but still anchor the reference box.
      `apps/editor/src/state/align.ts`
- [x] `flipNodes`, as a negative scale in the transform rather than a boolean pair on the node,
      since `scaleOf` already carries a flip in the sign of y. New `reflectAbout` in `math.ts`.
      No `centre` argument, unlike `rotateNodes`: flip has one gesture, so the pivot is always
      the selection's bounds centre. `apps/editor/src/state/flip.ts`
- [x] The auto layout engine's `plain` check compares absolute values on `a` and `d`, so a
      flipped child keeps its fill sizing instead of silently falling back to fixed.
      `packages/document/src/layout/autoLayout.ts`
- [x] Panel: an icon row in the Position section for the six aligns, the two distributes and the
      two flips. New icons in `icons.tsx`. Distribute hidden below three selected. Multiple
      selection now gets its own Position section, since align/distribute/flip need more than
      one node to be worth reaching for. `apps/editor/src/ui/PropertiesPanel.tsx`
- [x] Keyboard: Figma's Alt+A/D/W/S/H/V. `apps/editor/src/input/keyboardInput.ts`
- [x] Move the angle field out of Appearance into its own Rotation row under Position, next to
      the new flip icons. `apps/editor/src/ui/PropertiesPanel.tsx`

Auto layout
- [ ] Baseline alignment option in the cross-axis align control. Needs `LayoutAlign`
      (`node.ts:31`) split into separate main and cross unions first, since `mainAlign:
      'baseline'` is meaningless, and `TextMeasurer` (`autoLayout.ts:28`) widened to carry the
      ascent it currently computes and throws away (`text/layout.ts:56`).
      `apps/editor/src/ui/PropertiesPanel.tsx:357`
- [x] Collapse the Hug width/height checkboxes and the Fill width/height checkboxes into one
      `SegmentedField` per axis, docked in the Auto layout section rather than split across
      Size. Also now rendered for a plain node whose parent is an auto layout frame, which
      previously had nowhere to set Fill at all. `apps/editor/src/ui/PropertiesPanel.tsx`

Appearance
- [x] Independent per-corner radius in the model and the renderer. `cornerRadii` replaces the
      scalar, `SCHEMA_VERSION` 5 with a version-gated migration. New `packages/document/src/sdf.ts`
      owns `resolveCornerRadii` (the CSS single-scale-factor rule, not a per-corner clamp) and
      `distanceToRoundedBox`, and the packer, `ClipRegions` and `hit.ts` all consume it, which is
      what makes them agree rather than being three reimplementations. Both SDFs now pick a
      radius by quadrant before the `abs` that folds all four onto one.
- [x] Panel: a toggle switching the single `R` field into four, one per corner in `CORNER_ORDER`.
      Collapsing folds the four back to one value. `apps/editor/src/ui/PropertiesPanel.tsx`
- [x] Premultiplied alpha in the shape shader. Landed as the prerequisite for blend modes, and
      correct on its own: straight alpha makes `screen` over-dark at partial coverage. It changes
      no pixels, since `device.ts` configures `alphaMode: 'opaque'` and the pass clears opaque,
      so destination alpha is 1 throughout and the two forms of `normal` coincide.

Fill / Stroke
- [x] Multiple paints per node, not just `fills[0]` / `strokes[0]`. N paints is N instances,
      which the stroke path already demonstrated. `activeStroke` is gone, replaced by
      `drawnPaints` / `drawnStrokes` / `strokesOutset` in `paint.ts`, all of which return the
      list reversed so the panel's first row is the last instance packed and therefore the one
      on top. The panel's Fill and Stroke sections are lists with a per row remove.
- [x] Per-paint opacity and visibility toggle on each fill/stroke row. Both optional on
      `Paint` with absence meaning the default, so no `SCHEMA_VERSION` bump; opacity multiplies
      into `color.a` at pack time beside the alpha inherited from the tree.

New sections
- [x] Selection colors: a read-only summary of every color used across the current selection.
      Pure tally in `apps/editor/src/state/selectionColors.ts` (tested), rendered in
      `apps/editor/src/ui/PropertiesPanel.tsx`. Deliberately non-subscribing, the same choice
      the panel already makes for a multiple selection.

Deferred from this pass, with the reason:

The three below were designed in full and then deliberately dropped, to finish the visible panel
work first. The design for all of them is written up and can be picked up as it stands; none of
it is UI work, which is what took them out of scope rather than any problem with the approach.

- [ ] Gradient paint types, linear and radial. `Paint` is already written as a union so the type
      slots in, but stops are variable length, so they need a storage buffer at
      `@group(1) @binding(1)` indexed from the instance, following the `ClipRegions` precedent
      rather than inflating every instance in the stress grid. `params.x` is reserved for the
      index and bit 0 of the `flags.w` bitfield marks it. Note `clonePaint` is a `switch` that
      will stop compiling when the union grows, which is the intended alarm: a gradient's stops
      array needs its own deep copy or history and autosave share it.
- [ ] Effects: drop shadow. An SDF gives the shadow nearly free (offset the distance, smooth it
      over the blur), and bit 1 of the bitfield plus the two spare `flags` slots are reserved for
      it. The design's one non-obvious move: the offset goes in the instance's transform, not in
      the quad padding, because both padding computations assume uniform four-side padding and
      folding it into the transform leaves them unchanged. `hit.ts` deliberately does not grow
      for a shadow.
- [ ] Per-paint blend mode, as run-batched draws: contiguous runs of instances sharing a mode,
      one draw per run, so painter's order survives and a document using no blend modes stays
      exactly one draw call. Four exact modes only (normal, multiply, screen, linear-dodge);
      `darken` and `lighten` need min/max, which ignore the blend factors and seam every
      antialiased edge. No node-level mode, since run-batching blends each instance separately
      while Figma isolates the group. Premultiplied alpha, its prerequisite, has already landed.
      Would also want the page to gain a real white fill, since the canvas clears to a UI grey
      that a multiply paint would otherwise blend against.

- [ ] Image paint type. Needs asset storage in the document, image bytes in the save format, a
      runtime texture beyond the glyph atlas, and a fourth bind group.
- [ ] Inner shadow, layer blur, background blur. A blur needs the subtree rendered to an
      offscreen texture and a separate pass, which breaks the one-draw-call design.
- [ ] Panel header chrome (node-type dropdown, code/inspect icon, "make component" icon, "..."
      overflow menu). The code icon needs a dev mode inspector and the component icon needs a
      component/instance model; neither exists, so this is blocked on features rather than on
      panel work, and the remaining two are not worth the section alone.
- [ ] Editing a color from the Selection colors list, which is what Figma does with it.
- [ ] `darken` and `lighten` blend modes, and node-level (group-isolating) blend mode. Both need
      the subtree rendered to an offscreen target and composited in a second pass. The run list
      built for per-paint blending is exactly the data that pass would need to know where to
      break, so this is a follow-up rather than a rewrite.
- [ ] A per-corner radius past half the shorter side. `resolveCornerRadii` scales the four
      together the way CSS does, but `distanceToRoundedBox` then caps each at
      `min(half.x, half.y)`, because the `abs` fold that makes one rounded corner serve all four
      puts the arc's centre at `half - r` and a larger radius sends it through the middle of the
      box. CSS would draw that corner as a quarter disc spanning the whole box. Reaching that
      needs an SDF without the fold, and the cap is applied identically in the shader and in
      `hit.ts`, so drawing and hit testing still agree exactly. Only visible at extreme values.
- [ ] Gradient text. A glyph instance has exactly one free slot and the feature bitfield takes
      it, so a gradient on a text node falls back to stop 0's colour. Reachable later by packing
      the paint index into the high bits of that same float (f32 holds integers exactly to 2^24)
      or by a seventh vertex attribute.
- [ ] Knocking a shape out of its own drop shadow. The shadow is drawn behind the shape rather
      than masked by it, so a translucent fill shows its own shadow through. Needs a stencil or
      the caster's coverage at the shadow's pixel, neither of which exists in one pass.

## Panel UI3 pass

A visual and structural pass over the properties panel against Figma's UI3, 2026-08-23, plus
resizable side panels and a page background color. Shipped in one commit (`7edac60`), then
hardened by a ten-finding code review applied in full.

- [x] Filled field wells: `--field` darkened, new `--radius-field` token, hover border and
      accent focus shared by number fields, color chips and the new selects.
      `apps/editor/src/styles/tokens.css`, `NumberField.module.css`, `ColorField.module.css`
- [x] Icon labels on number fields (angle, radius, opacity, gap, padding) and icon options
      on segmented fields; label moves to `aria-label`. `apps/editor/src/ui/NumberField.tsx`,
      `SegmentedField.tsx`, `icons.tsx`
- [x] Sizing as a native select under each of W and H (Fixed / Hug contents / Fill container),
      replacing the segmented rows in the Auto layout section. The hug/fill capability rule is
      written once in `sizingChoices`; `isEditingText` counts a focused select as editing so
      the global shortcuts stay out of it. `apps/editor/src/ui/PropertiesPanel.tsx`,
      `apps/editor/src/input/isEditingText.ts`
- [x] A 3x3 `AlignmentGrid` beside direction/gap/padding in the Auto layout section;
      space-between lights the cross line and clicks then move only the cross axis.
      `apps/editor/src/ui/AlignmentGrid.tsx`
- [x] Appearance holds opacity and corner radius in one row; section hairlines and semibold
      titles; add/remove as icon buttons in section headers. `PropertiesPanel.module.css`
- [x] Both side panels resize by dragging their canvas edge: shared `PanelResizer`, clamp
      240-480, width on `--panel-width-left/right`, guarded localStorage, restore before
      first paint, double-click reset, keyboard nudge that consumes its arrows. The layers
      tree keeps a right margin so its scrollbar sits clear of the strip.
      `apps/editor/src/ui/PanelResizer.tsx`, `LayersPanel.module.css`, `App.module.css`
- [x] Page background color: a Page section when nothing is selected, the color a real
      document property on the root `PageNode` (absent means default, no schema bump),
      carried by `cloneNodeAs` so it survives save/load/undo, cleared to by the renderer,
      with one `DEFAULT_PAGE_BACKGROUND` constant shared by renderer and panel.
      `packages/document/src/node.ts`, `serialize.ts`, `WebGPURenderer.ts`

## Backlog

Deferred from the panel polish pass:

- [ ] Properties multi-select: editable shared fields with per-field Mixed detection, batch
      commit through one transact

Deferred when rotation was picked as the day 7-9 direction:

- [ ] Snapping: to guides, edges, and other shapes during drag/resize

Known gaps noted in CLAUDE.md as deliberate, not yet built:

- [ ] `clipsContent` clips per pixel but doesn't cull subtrees outside their clip yet
- [ ] Multi-selection resize on a rotated node scales along world axes, not its own
- [ ] Accent colour is hardcoded in `OverlayInstances`, needs to come from theme
- [ ] No spatial index; the 10k-node walk is the next real perf lever
