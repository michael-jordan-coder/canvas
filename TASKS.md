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

## Backlog

Deferred from the panel polish pass:

- [ ] Properties multi-select: editable shared fields with per-field Mixed detection, batch
      commit through one transact

Deferred when rotation was picked as the day 7-9 direction:

- [ ] Snapping: to guides, edges, and other shapes during drag/resize
- [ ] Text: a new text node type, inline editing, paragraph rendering

Known gaps noted in CLAUDE.md as deliberate, not yet built:

- [ ] Only `fills[0]` and `strokes[0]` are read; no multi-paint stacking
- [ ] `clipsContent` clips per pixel but doesn't cull subtrees outside their clip yet
- [ ] Multi-selection resize on a rotated node scales along world axes, not its own
- [ ] Accent colour is hardcoded in `OverlayInstances`, needs to come from theme
- [ ] No spatial index; the 10k-node walk is the next real perf lever
