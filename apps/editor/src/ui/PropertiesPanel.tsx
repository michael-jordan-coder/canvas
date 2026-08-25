import { useId, useRef, useState, type ComponentType, type ReactElement } from 'react'
import {
  angleOf,
  degrees,
  fromHex,
  DEFAULT_PAGE_BACKGROUND,
  isAutoLayoutFrame,
  isEffectVisible,
  isPainted,
  isPaintVisible,
  normalizeDegrees,
  paintColor,
  paintOpacity,
  toHex,
  radians,
  uniformCornerRadii,
  CORNER_ORDER,
  MAX_GRADIENT_STOPS,
  type DropShadow,
  type EllipseNode,
  type FrameLayout,
  type FrameNode,
  type GradientPaint,
  type GradientStop,
  type LayoutAlign,
  type LayoutDirection,
  type NodeId,
  type PageNode,
  type Paint,
  type PaintedNode,
  type RectangleNode,
  type RGBA,
  type SceneNode,
  type Size,
  type Stroke,
  type StrokeAlign,
  type TextNode,
} from '@canvas/document'
import { scene, useNode } from '../state/scene'
import { alignSelection, type AlignCommand } from '../state/align'
import {
  addAutoLayout,
  relayout,
  removeAutoLayout,
  updateFrameLayout,
  updateLayoutChild,
} from '../state/autoLayout'
import { flipNodes } from '../state/flip'
import { updateText } from '../state/font'
import { setNodesAngle } from '../state/rotate'
import { tallySelectionColors } from '../state/selectionColors'
import { useUI } from '../state/uiStore'
import { MIN_NODE_SIZE } from '../input/resize'
import { ColorField } from './ColorField'
import {
  AlignBottomIcon,
  AlignCenterXIcon,
  AlignCenterYIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  AngleIcon,
  ChevronIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  CornersIcon,
  DistributeHorizontalIcon,
  DistributeVerticalIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  GapIcon,
  HiddenIcon,
  MinusIcon,
  OpacityIcon,
  PaddingXIcon,
  PaddingYIcon,
  PlusIcon,
  RadiusIcon,
  SpaceBetweenIcon,
  VisibleIcon,
  type IconProps,
} from './icons'
import { AlignmentGrid } from './AlignmentGrid'
import { NumberField } from './NumberField'
import { PanelResizer } from './PanelResizer'
import { SegmentedField } from './SegmentedField'
import styles from './PropertiesPanel.module.css'

export function PropertiesPanel(): ReactElement {
  const selection = useUI((state) => state.selection)
  // Multiple selection deliberately subscribes to no node at all: the count comes from the
  // selection, so the panel must not wake when one of the selected nodes changes.
  const node = useNode(selection.length === 1 ? selection[0] : undefined)

  const title =
    selection.length > 1 ? `${selection.length} selected` : node ? node.name : 'Properties'

  return (
    <aside className={styles.panel}>
      <PanelResizer
        side="right"
        cssVar="--panel-width-right"
        storageKey="figma-canvas:properties-width"
        label="Resize properties panel"
      />
      <div className={styles.scroll}>
        <header className={styles.header}>{title}</header>
        <div className={styles.sections}>
        {selection.length > 1 && <MultiSelectionProperties selection={selection} />}
        {node && <NodeProperties node={node} />}
        {/*
          * Read-only, and shown for a single node too: selecting one frame summarises its
          * whole subtree, not just the one fill/stroke row above already edits directly.
          */}
        {selection.length > 0 && <SelectionColorsSection selection={selection} />}
        {selection.length === 0 && <PageSection />}
        </div>
      </div>
    </aside>
  )
}

/** Which of the frame's sizing slots a panel axis is, given the direction. */
function sizingKey(layout: FrameLayout, axis: keyof Size): 'mainSizing' | 'crossSizing' {
  const isMain = (axis === 'width') === (layout.direction === 'horizontal')
  return isMain ? 'mainSizing' : 'crossSizing'
}

/** Whether a frame's own layout sizes the given axis from its children. */
function isHugging(layout: FrameLayout | undefined, axis: keyof Size): boolean {
  return layout !== undefined && layout[sizingKey(layout, axis)] === 'hug'
}

/**
 * Whether an auto layout parent stretches this node to fill the given axis.
 *
 * Shared, unchanged, between the Size section's readOnly fields and the Auto layout
 * section's sizing control below, so what a field reports and what the control offers can
 * never disagree about the same node.
 */
function isFilling(node: SceneNode, inAutoLayout: boolean, axis: keyof Size): boolean {
  return (
    inAutoLayout &&
    (axis === 'width' ? node.layoutChild?.widthMode : node.layoutChild?.heightMode) === 'fill'
  )
}

const ALIGN_BUTTONS: ReadonlyArray<{
  command: AlignCommand
  label: string
  Icon: ComponentType<IconProps>
}> = [
  { command: 'left', label: 'Align left', Icon: AlignLeftIcon },
  { command: 'centerX', label: 'Align horizontal centers', Icon: AlignCenterXIcon },
  { command: 'right', label: 'Align right', Icon: AlignRightIcon },
  { command: 'top', label: 'Align top', Icon: AlignTopIcon },
  { command: 'centerY', label: 'Align vertical centers', Icon: AlignCenterYIcon },
  { command: 'bottom', label: 'Align bottom', Icon: AlignBottomIcon },
]

const DISTRIBUTE_BUTTONS: ReadonlyArray<{
  command: AlignCommand
  label: string
  Icon: ComponentType<IconProps>
}> = [
  { command: 'distributeHorizontal', label: 'Distribute horizontally', Icon: DistributeHorizontalIcon },
  { command: 'distributeVertical', label: 'Distribute vertically', Icon: DistributeVerticalIcon },
]

function AlignRow({ selection }: { selection: readonly NodeId[] }): ReactElement {
  return (
    <div className={styles.alignRow} role="group" aria-label="Align">
      {ALIGN_BUTTONS.map(({ command, label, Icon }) => (
        <button
          key={command}
          type="button"
          className={styles.iconButton}
          aria-label={label}
          onClick={() => alignSelection(scene, selection, command)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  )
}

function FlipButtons({ selection }: { selection: readonly NodeId[] }): ReactElement {
  return (
    <>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Flip horizontal"
        onClick={() => flipNodes(scene, selection, 'horizontal')}
      >
        <FlipHorizontalIcon size={16} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Flip vertical"
        onClick={() => flipNodes(scene, selection, 'vertical')}
      >
        <FlipVerticalIcon size={16} />
      </button>
    </>
  )
}

/**
 * What the panel shows for two or more selected nodes: no single node to subscribe to, so
 * only the commands that make sense across a selection as a whole. X/Y and rotation stay in
 * `NodeProperties`, which is the one node case, since a shared position or angle for a mixed
 * group is not something this pass adds.
 */
function MultiSelectionProperties({ selection }: { selection: readonly NodeId[] }): ReactElement {
  return (
    <>
      <section className={styles.section}>
        <AlignRow selection={selection} />
      </section>
      <section className={styles.section}>
        <h3 className={styles.title}>Arrange</h3>
        <div className={styles.iconRow} role="group" aria-label="Distribute and flip">
          {/* Distributing is a no-op below three nodes: two boxes have one gap, and equalising
              one gap changes nothing. */}
          {selection.length >= 3 &&
            DISTRIBUTE_BUTTONS.map(({ command, label, Icon }) => (
              <button
                key={command}
                type="button"
                className={styles.iconButton}
                aria-label={label}
                onClick={() => alignSelection(scene, selection, command)}
              >
                <Icon size={16} />
              </button>
            ))}
          <FlipButtons selection={selection} />
        </div>
      </section>
    </>
  )
}

function NodeProperties({ node }: { node: SceneNode }): ReactElement {
  // The parent decides whether position and size belong to a layout, and its own layout can
  // change under a still selected child, so the panel subscribes to it too.
  const parent = useNode(node.parent ?? undefined)
  const inAutoLayout = isAutoLayoutFrame(parent)
  const layout = node.type === 'frame' ? node.layout : undefined
  const selection: NodeId[] = [node.id]

  const setSize = (size: Size): void => {
    scene.transact(() => {
      scene.update(node.id, { size })
      relayout(scene, [node.id])
    })
  }

  const hugs = (axis: keyof Size): boolean => isHugging(layout, axis)
  const fills = (axis: keyof Size): boolean => isFilling(node, inAutoLayout, axis)

  return (
    <>
      <section className={styles.section}>
        <AlignRow selection={selection} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Position</h3>
        <div className={styles.grid}>
          {/* Inside an auto layout frame position belongs to the layout, so both report. */}
          <NumberField
            label="X"
            readOnly={inAutoLayout}
            value={node.transform.tx}
            onCommit={(tx) => scene.update(node.id, { transform: { ...node.transform, tx } })}
          />
          <NumberField
            label="Y"
            readOnly={inAutoLayout}
            value={node.transform.ty}
            onCommit={(ty) => scene.update(node.id, { transform: { ...node.transform, ty } })}
          />
        </div>
        <div className={styles.headed}>
          <div className={styles.suffixed}>
            <NumberField
              label="Rotation"
              icon={<AngleIcon size={14} />}
              value={normalizeDegrees(degrees(angleOf(scene.worldTransform(node.id))))}
              onCommit={(value) => setNodesAngle(scene, [node.id], radians(normalizeDegrees(value)))}
            />
            <span className={styles.suffix} aria-hidden="true">
              &deg;
            </span>
          </div>
          <FlipButtons selection={selection} />
        </div>
        <div className={styles.grid}>
          {/*
            * On text, W is editable only once the box is fixed width, where it is the width
            * lines wrap to. H always reports: it is however many lines that produces, and a
            * field that set it would be overwritten by the next keystroke. A hug axis and a
            * fill axis report for the same reason: the number is the layout's answer.
            */}
          <NumberField
            label="W"
            readOnly={(node.type === 'text' && node.autoWidth) || hugs('width') || fills('width')}
            value={node.size.width}
            onCommit={(width) =>
              node.type === 'text'
                ? setTextWidth(node, Math.max(MIN_NODE_SIZE, width))
                : setSize({ ...node.size, width: Math.max(MIN_NODE_SIZE, width) })
            }
          />
          <NumberField
            label="H"
            readOnly={node.type === 'text' || hugs('height') || fills('height')}
            value={node.size.height}
            onCommit={(height) =>
              setSize({ ...node.size, height: Math.max(MIN_NODE_SIZE, height) })
            }
          />
          {/* The sizing mode sits under the number it explains, the way Figma hangs it.
              Both cells render whenever either has a choice, so the columns stay aligned. */}
          {(hasSizingChoice(node, inAutoLayout, 'width') ||
            hasSizingChoice(node, inAutoLayout, 'height')) && (
            <>
              <div>
                <SizingSelect node={node} inAutoLayout={inAutoLayout} axis="width" />
              </div>
              <div>
                <SizingSelect node={node} inAutoLayout={inAutoLayout} axis="height" />
              </div>
            </>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Appearance</h3>
        <div className={styles.grid}>
          <div className={styles.suffixed}>
            <NumberField
              label="Opacity"
              icon={<OpacityIcon size={14} />}
              value={Math.round(node.opacity * 100)}
              onCommit={(percent) =>
                scene.update(node.id, { opacity: Math.min(1, Math.max(0, percent / 100)) })
              }
            />
            <span className={styles.suffix} aria-hidden="true">
              %
            </span>
          </div>
          {/* Opacity and corner radius share the row, the way Figma pairs them. */}
          {(node.type === 'rectangle' || node.type === 'frame') && (
            <CornerRadiiField key={node.id} node={node} />
          )}
        </div>
        {node.type === 'frame' && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={node.clipsContent}
              onChange={(event) =>
                scene.update<FrameNode>(node.id, { clipsContent: event.target.checked })
              }
            />
            Clip content
          </label>
        )}
      </section>

      {node.type === 'frame' && <AutoLayoutSection node={node} />}
      {node.type === 'text' && <TextSection node={node} />}
      {isPainted(node) && <FillSection node={node} />}
      {/*
        * Text carries strokes because every painted node does, but nothing draws them, so
        * offering the control would be offering a setting with no effect.
        */}
      {isPainted(node) && node.type !== 'text' && <StrokeSection node={node} />}
      {/* Text has no effects at all in the model, so the guard is the same one strokes use. */}
      {(node.type === 'frame' || node.type === 'rectangle' || node.type === 'ellipse') && (
        <EffectsSection node={node} />
      )}
    </>
  )
}

/** The single R field's radius, or the four-corner editor it expands into. */
const CORNER_LABELS: Record<(typeof CORNER_ORDER)[number], string> = {
  topLeft: 'TL',
  topRight: 'TR',
  bottomRight: 'BR',
  bottomLeft: 'BL',
}

function CornerRadiiField({ node }: { node: RectangleNode | FrameNode }): ReactElement {
  const [expanded, setExpanded] = useState(false)

  const collapse = (): void => {
    // A deliberate flattening, the same one field for all four corners the R field always
    // meant: whatever the top-left corner currently holds becomes every corner's value.
    scene.update<RectangleNode>(node.id, {
      cornerRadii: uniformCornerRadii(Math.max(0, node.cornerRadii.topLeft)),
    })
    setExpanded(false)
  }

  return (
    <>
      {/* One cell of the Appearance grid, beside opacity; the R field always means all
          four corners, whether or not the per-corner editor below is open. */}
      <div className={styles.radiusCell}>
        <NumberField
          label="Corner radius"
          icon={<RadiusIcon size={14} />}
          value={node.cornerRadii.topLeft}
          onCommit={(radius) =>
            scene.update<RectangleNode>(node.id, {
              cornerRadii: uniformCornerRadii(Math.max(0, radius)),
            })
          }
        />
        <button
          type="button"
          className={styles.iconButton}
          aria-label={expanded ? 'Use one radius for all corners' : 'Edit each corner'}
          aria-pressed={expanded}
          onClick={() => (expanded ? collapse() : setExpanded(true))}
        >
          <CornersIcon size={14} />
        </button>
      </div>
      {expanded && (
        <div className={styles.corners}>
          {CORNER_ORDER.map((corner) => (
            <NumberField
              key={corner}
              label={CORNER_LABELS[corner]}
              value={node.cornerRadii[corner]}
              onCommit={(radius) =>
                scene.update<RectangleNode>(node.id, {
                  cornerRadii: { ...node.cornerRadii, [corner]: Math.max(0, radius) },
                })
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

const DIRECTIONS: readonly { value: LayoutDirection; label: string; icon: ReactElement }[] = [
  { value: 'horizontal', label: 'Horizontal', icon: <ArrowRightIcon size={14} /> },
  { value: 'vertical', label: 'Vertical', icon: <ArrowDownIcon size={14} /> },
]

type SizingValue = 'fixed' | 'hug' | 'fill'

const modeKey = (axis: keyof Size): 'widthMode' | 'heightMode' =>
  axis === 'width' ? 'widthMode' : 'heightMode'

/**
 * What the axis can offer beyond a plain number. The one writing of the rule: the render
 * guard asks whether either flag is up, the select turns each into an option.
 */
function sizingChoices(
  node: SceneNode,
  inAutoLayout: boolean,
  axis: keyof Size,
): { canHug: boolean; canFill: boolean } {
  const canHug = node.type === 'frame' && node.layout !== undefined
  // Text height is measured from the text, so it is never anyone's to fill.
  const canFill = inAutoLayout && !(axis === 'height' && node.type === 'text')
  return { canHug, canFill }
}

function hasSizingChoice(node: SceneNode, inAutoLayout: boolean, axis: keyof Size): boolean {
  const { canHug, canFill } = sizingChoices(node, inAutoLayout, axis)
  return canHug || canFill
}

function setSizing(
  node: SceneNode,
  inAutoLayout: boolean,
  axis: keyof Size,
  value: SizingValue,
): void {
  const layout = node.type === 'frame' ? node.layout : undefined
  scene.transact(() => {
    if (value === 'hug') {
      if (layout) updateFrameLayout(scene, node.id, { [sizingKey(layout, axis)]: 'hug' })
      // A fill inherited from the parent would otherwise still win at layout time (the
      // parent forces this axis's size regardless of what this node's own hug would have
      // computed), so picking Hug here has to clear it rather than leave a silent no-op.
      if (isFilling(node, inAutoLayout, axis)) {
        updateLayoutChild(scene, node, { [modeKey(axis)]: 'fixed' })
      }
    } else if (value === 'fill') {
      // updateLayoutChild already flips a hugging axis of this same frame to fixed; that
      // fill-beats-hug resolution lives there and is not repeated here.
      updateLayoutChild(scene, node, { [modeKey(axis)]: 'fill' })
    } else {
      if (layout && isHugging(layout, axis)) {
        updateFrameLayout(scene, node.id, { [sizingKey(layout, axis)]: 'fixed' })
      }
      if (isFilling(node, inAutoLayout, axis)) {
        updateLayoutChild(scene, node, { [modeKey(axis)]: 'fixed' })
      }
    }
  })
}

/**
 * The per-axis sizing mode, as the dropdown Figma hangs under each size field: Fixed, Hug
 * contents, Fill container. It used to be a segmented row in the Auto layout section, but
 * the mode answers "what is this number", so it belongs directly under the number it
 * explains. `AxisSizing` (this node's own hug/fixed) and `ChildSizing` (fill/fixed from
 * its parent) are disjoint types on two different objects, unified here into one control.
 */
function SizingSelect({
  node,
  inAutoLayout,
  axis,
}: {
  node: SceneNode
  inAutoLayout: boolean
  axis: keyof Size
}): ReactElement | null {
  const { canHug, canFill } = sizingChoices(node, inAutoLayout, axis)
  if (!canHug && !canFill) return null

  const layout = node.type === 'frame' ? node.layout : undefined

  // Fill is read before hug because that is the order the engine resolves them in: a parent
  // forces this axis's size, and `#resolveSize` hands that forced value straight through as
  // the frame's own, so the hug never runs. `setSizing` clears one when the other is picked,
  // so the panel cannot produce a node with both, but a loaded file can, and in that file the
  // canvas would be filling. Reporting hug there would be the control disagreeing with what
  // is on screen.
  const value: SizingValue = isFilling(node, inAutoLayout, axis)
    ? 'fill'
    : isHugging(layout, axis)
      ? 'hug'
      : 'fixed'

  return (
    <div className={styles.selectWrap}>
      <select
        className={styles.select}
        aria-label={axis === 'width' ? 'Width sizing' : 'Height sizing'}
        value={value}
        onChange={(event) => setSizing(node, inAutoLayout, axis, event.target.value as SizingValue)}
      >
        <option value="fixed">{axis === 'width' ? 'Fixed width' : 'Fixed height'}</option>
        {canHug && <option value="hug">Hug contents</option>}
        {canFill && <option value="fill">Fill container</option>}
      </select>
      <span className={styles.selectChevron} aria-hidden="true">
        <ChevronIcon size={12} />
      </span>
    </div>
  )
}

/** The frame's own layout: direction, spacing and alignment. Sizing lives under W and H. */
function AutoLayoutSection({ node }: { node: FrameNode }): ReactElement {
  const layout = node.layout
  // What mainAlign was before space-between switched on, so toggling it off is a true
  // revert rather than a jump to some third alignment. 'start' covers a frame that was
  // already spaced when it arrived here, matching the layout default.
  const packedAlign = useRef<LayoutAlign>('start')

  if (!layout) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.title}>Auto layout</h3>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Add auto layout"
            onClick={() => addAutoLayout(scene, node.id)}
          >
            <PlusIcon size={14} />
          </button>
        </div>
      </section>
    )
  }

  const set = (changes: Partial<FrameLayout>): void =>
    updateFrameLayout(scene, node.id, changes)
  const spaced = layout.mainAlign === 'space-between'

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.title}>Auto layout</h3>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Remove auto layout"
          onClick={() => removeAutoLayout(scene, node.id)}
        >
          <MinusIcon size={14} />
        </button>
      </div>
      {/*
        * Direction and spacing stack beside the alignment grid, the way the two halves of
        * the question sit in Figma: how the children flow on the left, where they sit on
        * the right.
        */}
      <div className={styles.autoRow}>
        <div className={styles.autoControls}>
          <SegmentedField
            hideLabel
            label="Direction"
            value={layout.direction}
            options={DIRECTIONS}
            onChange={(direction: LayoutDirection) => set({ direction })}
          />
          <div className={styles.gapRow}>
            <NumberField
              label="Gap"
              icon={<GapIcon size={14} />}
              value={layout.gap}
              onCommit={(gap) => set({ gap: Math.max(0, gap) })}
            />
            {/* Space between overrides the gap, so it lives beside the number it silences. */}
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Space between"
              aria-pressed={spaced}
              title="Space between"
              onClick={() => {
                if (spaced) {
                  set({ mainAlign: packedAlign.current })
                } else {
                  packedAlign.current = layout.mainAlign
                  set({ mainAlign: 'space-between' })
                }
              }}
            >
              <SpaceBetweenIcon size={14} />
            </button>
          </div>
          {/*
            * The panel edits padding as a horizontal and a vertical pair, which is Figma's
            * own resting shape for it. The model keeps all four sides, so a per side editor
            * can land later without touching the file format.
            */}
          <div className={styles.grid}>
            <NumberField
              label="Horizontal padding"
              icon={<PaddingXIcon size={14} />}
              value={layout.padding.left}
              onCommit={(value) => {
                const side = Math.max(0, value)
                set({ padding: { ...layout.padding, left: side, right: side } })
              }}
            />
            <NumberField
              label="Vertical padding"
              icon={<PaddingYIcon size={14} />}
              value={layout.padding.top}
              onCommit={(value) => {
                const side = Math.max(0, value)
                set({ padding: { ...layout.padding, top: side, bottom: side } })
              }}
            />
          </div>
        </div>
        <AlignmentGrid
          direction={layout.direction}
          mainAlign={layout.mainAlign}
          crossAlign={layout.crossAlign}
          onChange={(align) => set(align)}
        />
      </div>
    </section>
  )
}

/** Below 1 the text is a smudge, and the field's own floor keeps a typo from erasing it. */
const MIN_FONT_SIZE = 1

/** Setting a width is what makes a box fixed width, the same as dragging its edge. */
function setTextWidth(node: TextNode, width: number): void {
  updateText(node, { autoWidth: false, size: { ...node.size, width } })
}

function TextSection({ node }: { node: TextNode }): ReactElement {
  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Text</h3>
      <NumberField
        wide
        label="Size"
        value={node.fontSize}
        onCommit={(value) => updateText(node, { fontSize: Math.max(MIN_FONT_SIZE, value) })}
      />
      {/*
        * Dragging a side handle sets this, and this is how it comes back off. Without it the
        * conversion would be one way: nothing else in the editor returns a box to sizing
        * itself to its words.
        */}
      <label className={styles.toggle}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={node.autoWidth}
          onChange={(event) => updateText(node, { autoWidth: event.target.checked })}
        />
        Auto width
      </label>
    </section>
  )
}

/**
 * What "Add fill" starts from: the same colours the tools draw with, so a frame gains the
 * white a drawn frame would have had, and a shape the grey a drawn shape would.
 */
const defaultFillFor = (node: PaintedNode): Paint =>
  fromHex(node.type === 'frame' ? '#ffffff' : '#c4c4c4')

/**
 * Converting between paint kinds keeps what the kinds share and invents the least it can
 * for the rest. Solid to gradient starts as the Figma default, the colour fading to its own
 * transparent, so the change is visible without being a surprise. Gradient to solid keeps
 * the first stop, the one colour that stands for the paint everywhere else. Linear and
 * radial swap freely, reading the same two points each in their own way, so a round trip
 * between them loses nothing.
 */
function convertPaint(paint: Paint, kind: Paint['type']): Paint {
  if (kind === paint.type) return paint
  const base = {
    ...(paint.opacity !== undefined ? { opacity: paint.opacity } : {}),
    ...(paint.visible !== undefined ? { visible: paint.visible } : {}),
  }
  if (kind === 'solid') return { type: 'solid', color: { ...paintColor(paint) }, ...base }
  if (paint.type !== 'solid') {
    return { ...paint, type: kind, stops: paint.stops.map((stop) => ({ ...stop, color: { ...stop.color } })) }
  }
  const stops: GradientStop[] = [
    { position: 0, color: { ...paint.color } },
    { position: 1, color: { ...paint.color, a: 0 } },
  ]
  return kind === 'linear'
    ? { type: 'linear', from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, stops, ...base }
    : { type: 'radial', from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 }, stops, ...base }
}

/**
 * The ramp and its stops, drawn as SVG because the preview is a dynamic set of colours and
 * the convention keeps those on presentation attributes rather than style props.
 *
 * Dragging a stop clamps it between its neighbours instead of re-sorting past them, which
 * keeps the index under the pointer stable for the whole gesture and keeps the stops array
 * sorted by construction, the invariant the shader walk depends on. The drag is one history
 * group, the same shape the colour picker's session is.
 */
function GradientRamp({
  paint,
  onChange,
}: {
  paint: GradientPaint
  onChange: (paint: GradientPaint) => void
}): ReactElement {
  const id = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const grouped = useRef(false)

  const moveStop = (index: number, clientX: number): void => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const t = (clientX - rect.left) / rect.width
    const low = paint.stops[index - 1]?.position ?? 0
    const high = paint.stops[index + 1]?.position ?? 1
    const position = Math.min(high, Math.max(low, Math.min(1, Math.max(0, t))))
    onChange({
      ...paint,
      stops: paint.stops.map((stop, i) => (i === index ? { ...stop, position } : stop)),
    })
  }

  return (
    <svg ref={svgRef} className={styles.ramp} aria-label="Gradient ramp">
      <defs>
        {/* Always left to right: this previews the ramp, not the node's geometry. */}
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          {paint.stops.map((stop, index) => (
            <stop
              key={index}
              offset={stop.position}
              stopColor={toHex(stop.color)}
              stopOpacity={stop.color.a}
            />
          ))}
        </linearGradient>
      </defs>
      <rect className={styles.rampBody} width="100%" height="100%" rx="4" fill={`url(#${id})`} />
      {paint.stops.map((stop, index) => (
        <circle
          key={index}
          className={styles.rampStop}
          cx={`${stop.position * 100}%`}
          cy="50%"
          r="5"
          fill={toHex(stop.color)}
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            if (!grouped.current) {
              scene.beginHistoryGroup()
              grouped.current = true
            }
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            moveStop(index, event.clientX)
          }}
          onPointerUp={() => {
            if (!grouped.current) return
            grouped.current = false
            scene.endHistoryGroup()
          }}
        />
      ))}
    </svg>
  )
}

/** The largest gap between neighbouring stops, so a new stop lands where there is room. */
function widestGapMidpoint(stops: readonly GradientStop[]): number {
  let at = 0.5
  let widest = -1
  for (let index = 0; index < stops.length - 1; index += 1) {
    const gap = stops[index + 1]!.position - stops[index]!.position
    if (gap > widest) {
      widest = gap
      at = stops[index]!.position + gap / 2
    }
  }
  return at
}

function GradientEditor({
  paint,
  onChange,
}: {
  paint: GradientPaint
  onChange: (paint: GradientPaint) => void
}): ReactElement {
  const setStop = (index: number, next: Partial<GradientStop>): void =>
    onChange({
      ...paint,
      stops: paint.stops.map((stop, i) => (i === index ? { ...stop, ...next } : stop)),
    })

  const addStop = (): void => {
    if (paint.stops.length >= MAX_GRADIENT_STOPS) return
    const position = widestGapMidpoint(paint.stops)
    const index = paint.stops.findIndex((stop) => stop.position > position)
    const nearest = paint.stops[index === -1 ? paint.stops.length - 1 : Math.max(0, index - 1)]
    const stop: GradientStop = { position, color: { ...(nearest?.color ?? { r: 0, g: 0, b: 0, a: 1 }) } }
    const at = index === -1 ? paint.stops.length : index
    onChange({ ...paint, stops: [...paint.stops.slice(0, at), stop, ...paint.stops.slice(at)] })
  }

  // The axis's angle in box space, for the numeric field below. On-canvas handles for the
  // two points are a separate pass; the angle covers the common ask until then.
  const setAngle = (value: number): void => {
    const cx = (paint.from.x + paint.to.x) / 2
    const cy = (paint.from.y + paint.to.y) / 2
    const half =
      Math.hypot(paint.to.x - paint.from.x, paint.to.y - paint.from.y) / 2 || 0.5
    const rad = radians(value)
    const dx = Math.cos(rad) * half
    const dy = Math.sin(rad) * half
    onChange({ ...paint, from: { x: cx - dx, y: cy - dy }, to: { x: cx + dx, y: cy + dy } })
  }

  return (
    <>
      <div className={styles.headed}>
        <GradientRamp paint={paint} onChange={onChange} />
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Add stop"
          disabled={paint.stops.length >= MAX_GRADIENT_STOPS}
          onClick={addStop}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {paint.type === 'linear' && (
        <NumberField
          wide
          label="Angle"
          icon={<AngleIcon size={14} />}
          value={Math.round(
            normalizeDegrees(
              degrees(Math.atan2(paint.to.y - paint.from.y, paint.to.x - paint.from.x)),
            ),
          )}
          onCommit={setAngle}
        />
      )}
      {paint.stops.map((stop, index) => (
        <div className={styles.headed} key={index}>
          <ColorField
            label="Stop"
            color={stop.color}
            onChange={(color: RGBA) => setStop(index, { color })}
          />
          {/* The stop's own alpha. The picker cannot edit it, so it gets a field the way a
            * paint's opacity does; the two multiply rather than replace each other. */}
          <div className={styles.paintOpacity}>
            <NumberField
              label="A"
              value={Math.round(stop.color.a * 100)}
              onCommit={(percent) =>
                setStop(index, {
                  color: { ...stop.color, a: Math.min(1, Math.max(0, percent / 100)) },
                })
              }
            />
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Remove stop"
            disabled={paint.stops.length <= 1}
            onClick={() =>
              onChange({ ...paint, stops: paint.stops.filter((_, i) => i !== index) })
            }
          >
            <MinusIcon size={14} />
          </button>
        </div>
      ))}
    </>
  )
}

/**
 * One paint of a stack: its kind, its own opacity, whether it draws, and a way out, with
 * the kind's own editor beneath: a colour well for a solid, the ramp for a gradient.
 *
 * The row is the same for a fill and for a stroke, because a stroke's paint is a paint. What
 * differs is what sits beneath it, which is the caller's business.
 */
function PaintRow({
  label,
  paint,
  onChange,
  onRemove,
}: {
  label: string
  paint: Paint
  onChange: (paint: Paint) => void
  onRemove: () => void
}): ReactElement {
  const visible = isPaintVisible(paint)

  return (
    <div className={styles.paintGroup}>
      <div className={styles.headed}>
        <div className={styles.selectWrap}>
          <select
            className={styles.select}
            aria-label={`${label} type`}
            value={paint.type}
            onChange={(event) =>
              onChange(convertPaint(paint, event.target.value as Paint['type']))
            }
          >
            <option value="solid">Solid</option>
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
          </select>
          <span className={styles.selectChevron} aria-hidden="true">
            <ChevronIcon size={12} />
          </span>
        </div>
        {/*
          * Its own opacity, which multiplies with the colour's alpha and with the node's
          * rather than replacing either. Whole percent, the same units the node's O field uses.
          */}
        <div className={styles.paintOpacity}>
          <NumberField
            label="%"
            value={Math.round(paintOpacity(paint) * 100)}
            onCommit={(percent) =>
              onChange({ ...paint, opacity: Math.min(1, Math.max(0, percent / 100)) })
            }
          />
        </div>
        <button
          type="button"
          className={styles.eye}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          onClick={() => onChange({ ...paint, visible: !visible })}
        >
          {visible ? <VisibleIcon size={12} /> : <HiddenIcon size={12} />}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <MinusIcon size={14} />
        </button>
      </div>
      {paint.type === 'solid' ? (
        <ColorField
          label={label}
          color={paint.color}
          onChange={(color: RGBA) => onChange({ ...paint, color })}
        />
      ) : (
        <GradientEditor paint={paint} onChange={onChange} />
      )}
    </div>
  )
}

function FillSection({ node }: { node: PaintedNode }): ReactElement {
  const setFills = (fills: Paint[]): void => {
    scene.update<PaintedNode>(node.id, { fills })
  }

  return (
    <section className={styles.section}>
      {/*
        * A node without a fill still gets the section, offering one from the header. The
        * wrap frame Shift+A creates is deliberately transparent, and without this it could
        * never stop being so. The new paint goes on top of the stack, which is where Figma
        * puts it and the only end where adding one is visible rather than hidden under what
        * is already there.
        */}
      <div className={styles.sectionHeader}>
        <h3 className={styles.title}>Fill</h3>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Add fill"
          onClick={() => setFills([defaultFillFor(node), ...node.fills])}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {node.fills.map((fill, index) => (
        <PaintRow
          // A paint has no identity of its own, and its place in the stack is exactly what
          // it is, so the index is the key rather than a stand-in for one.
          key={index}
          label="Fill"
          paint={fill}
          onChange={(paint) => setFills(node.fills.map((at, i) => (i === index ? paint : at)))}
          onRemove={() => setFills(node.fills.filter((_, i) => i !== index))}
        />
      ))}
    </section>
  )
}

/**
 * Figma's own default: a one unit line just inside the edge, so the footprint does not move.
 *
 * Built fresh per call rather than shared, now that a node can hold several strokes and two
 * of them could otherwise be the same object.
 */
const defaultStroke = (): Stroke => ({ paint: fromHex('#1a1a1a'), weight: 1, align: 'inside' })

const ALIGNMENTS = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' },
] as const satisfies readonly { value: StrokeAlign; label: string }[]

function StrokeSection({ node }: { node: PaintedNode }): ReactElement {
  const setStrokes = (strokes: Stroke[]): void => {
    scene.update<PaintedNode>(node.id, { strokes })
  }
  // Weight and alignment are per stroke in the model, so they are per stroke here too. A
  // shared pair of fields would have to pick one stroke's values to show and would then be
  // lying about the others.
  const set = (index: number, next: Partial<Stroke>): void =>
    setStrokes(node.strokes.map((stroke, i) => (i === index ? { ...stroke, ...next } : stroke)))

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.title}>Stroke</h3>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Add stroke"
          onClick={() => setStrokes([defaultStroke(), ...node.strokes])}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {node.strokes.length > 0 && (
        <div className={styles.paintGroups}>
          {node.strokes.map((stroke, index) => (
            <div className={styles.paintGroup} key={index}>
              <PaintRow
                label="Stroke"
                paint={stroke.paint}
                onChange={(paint) => set(index, { paint })}
                onRemove={() => setStrokes(node.strokes.filter((_, i) => i !== index))}
              />
              <SegmentedField
                label="Align"
                value={stroke.align}
                options={ALIGNMENTS}
                onChange={(align: StrokeAlign) => set(index, { align })}
              />
              <NumberField
                wide
                label="Weight"
                value={stroke.weight}
                onCommit={(weight) => set(index, { weight: Math.max(0, weight) })}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** The nodes that can carry a shadow: every box. Text is out of scope, see the model. */
type EffectNode = FrameNode | RectangleNode | EllipseNode

/** Figma's own default shadow: a soft quarter-black drop, four units down. */
const defaultShadow = (): DropShadow => ({
  offset: { x: 0, y: 4 },
  blur: 4,
  spread: 0,
  color: { r: 0, g: 0, b: 0, a: 0.25 },
})

/**
 * Drop shadows, as a stack the way fills and strokes are. The colour well edits the shadow's
 * RGB and the % beside it the alpha, which is where a shadow's softness usually lives.
 */
function EffectsSection({ node }: { node: EffectNode }): ReactElement {
  const effects = node.effects ?? []
  const setEffects = (next: DropShadow[]): void => {
    scene.update<EffectNode>(node.id, { effects: next })
  }
  const set = (index: number, next: Partial<DropShadow>): void =>
    setEffects(effects.map((effect, i) => (i === index ? { ...effect, ...next } : effect)))

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.title}>Drop shadow</h3>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Add drop shadow"
          onClick={() => setEffects([defaultShadow(), ...effects])}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {effects.length > 0 && (
        <div className={styles.paintGroups}>
          {effects.map((effect, index) => {
            const visible = isEffectVisible(effect)
            return (
              <div className={styles.paintGroup} key={index}>
                <div className={styles.headed}>
                  <ColorField
                    label="Shadow"
                    color={effect.color}
                    onChange={(color: RGBA) => set(index, { color })}
                  />
                  <div className={styles.paintOpacity}>
                    <NumberField
                      label="%"
                      value={Math.round(effect.color.a * 100)}
                      onCommit={(percent) =>
                        set(index, {
                          color: {
                            ...effect.color,
                            a: Math.min(1, Math.max(0, percent / 100)),
                          },
                        })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.eye}
                    aria-label={visible ? 'Hide shadow' : 'Show shadow'}
                    onClick={() => set(index, { visible: !visible })}
                  >
                    {visible ? <VisibleIcon size={12} /> : <HiddenIcon size={12} />}
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Remove shadow"
                    onClick={() => setEffects(effects.filter((_, i) => i !== index))}
                  >
                    <MinusIcon size={14} />
                  </button>
                </div>
                <div className={styles.grid}>
                  <NumberField
                    label="X"
                    value={effect.offset.x}
                    onCommit={(x) => set(index, { offset: { ...effect.offset, x } })}
                  />
                  <NumberField
                    label="Y"
                    value={effect.offset.y}
                    onCommit={(y) => set(index, { offset: { ...effect.offset, y } })}
                  />
                  <NumberField
                    label="B"
                    value={effect.blur}
                    onCommit={(blur) => set(index, { blur: Math.max(0, blur) })}
                  />
                  <NumberField
                    label="S"
                    value={effect.spread}
                    onCommit={(spread) => set(index, { spread })}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * Shown when nothing is selected: the page itself is what the panel describes, and its one
 * property is the colour the canvas clears to. Editing it is a real document edit, in the
 * file and in history, which is why it lives on the root node rather than in UI state.
 */
function PageSection(): ReactElement {
  const page = useNode(scene.rootId)
  const color =
    (page?.type === 'page' ? page.backgroundColor : undefined) ?? DEFAULT_PAGE_BACKGROUND

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Page</h3>
      <div className={styles.headed}>
        <ColorField
          label="Page"
          color={color}
          onChange={(next: RGBA) =>
            scene.update<PageNode>(scene.rootId, { backgroundColor: next })
          }
        />
      </div>
    </section>
  )
}

/**
 * A read-only tally of every colour drawn anywhere in the selection, most used first.
 *
 * Recomputed on whatever render the selection already caused and nothing else: it walks
 * `scene` (a mutable store outside React) directly rather than subscribing through `useNode`,
 * the same choice `PropertiesPanel` already makes for a multiple selection. Subscribing per
 * node would mean re-walking every selected subtree on every edit anywhere inside it, for a
 * summary that is read far less often than the document changes; this list can go stale
 * between edits and catches up the next time the selection itself changes.
 */
function SelectionColorsSection({ selection }: { selection: readonly NodeId[] }): ReactElement | null {
  const colors = tallySelectionColors(scene, selection)
  if (colors.length === 0) return null

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Selection colors</h3>
      <div className={styles.colors}>
        {colors.map(({ hex, count }) => (
          <div className={styles.color} key={hex}>
            <svg className={styles.swatch} width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
              {/* The fill is the one dynamic colour on this page; it goes on the SVG's own
                  presentation attribute rather than a style prop. */}
              <rect x="0.5" y="0.5" width="13" height="13" rx="2" fill={hex} />
            </svg>
            <span className={styles.colorHex}>{hex.slice(1).toUpperCase()}</span>
            <span className={styles.colorCount}>{count}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
