import { useState, type ComponentType, type ReactElement } from 'react'
import {
  angleOf,
  degrees,
  fromHex,
  isAutoLayoutFrame,
  isPainted,
  isPaintVisible,
  normalizeDegrees,
  paintOpacity,
  radians,
  uniformCornerRadii,
  CORNER_ORDER,
  type FrameLayout,
  type FrameNode,
  type LayoutAlign,
  type LayoutDirection,
  type ComponentNode,
  type NodeId,
  type Paint,
  type PaintedNode,
  type RectangleNode,
  type RGBA,
  type SceneNode,
  type Size,
  type Stroke,
  type StrokeAlign,
  type TextNode,
} from '@figma-canvas/document'
import { scene, useNode } from '../state/scene'
import { alignSelection, type AlignCommand } from '../state/align'
import {
  addAutoLayout,
  relayout,
  removeAutoLayout,
  updateFrameLayout,
  updateLayoutChild,
} from '../state/autoLayout'
import { setComponentAutoSize, updateComponentProps } from '../state/componentNodes'
import { componentSpec, useLibrary, type PropKind } from '../components/registry'
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
  CornersIcon,
  DistributeHorizontalIcon,
  DistributeVerticalIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  HiddenIcon,
  VisibleIcon,
  type IconProps,
} from './icons'
import { NumberField } from './NumberField'
import { SegmentedField } from './SegmentedField'
import { SelectField } from './SelectField'
import { TextField } from './TextField'
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
      <header className={styles.header}>{title}</header>
      <div className={styles.sections}>
        {selection.length > 1 && <MultiSelectionProperties selection={selection} />}
        {node && <NodeProperties node={node} />}
        {/*
          * Read-only, and shown for a single node too: selecting one frame summarises its
          * whole subtree, not just the one fill/stroke row above already edits directly.
          */}
        {selection.length > 0 && <SelectionColorsSection selection={selection} />}
      </div>
      {selection.length === 0 && <p className={styles.empty}>Nothing selected</p>}
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
    <div className={styles.iconRow} role="group" aria-label="Align">
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

/** Distributing needs a first, a last and something between them to space out. */
function DistributeRow({ selection }: { selection: readonly NodeId[] }): ReactElement {
  return (
    <div className={styles.iconRow} role="group" aria-label="Distribute">
      {DISTRIBUTE_BUTTONS.map(({ command, label, Icon }) => (
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
    <section className={styles.section}>
      <h3 className={styles.title}>Position</h3>
      <AlignRow selection={selection} />
      {/* A no-op below three nodes: two boxes have one gap, and equalising one gap changes nothing. */}
      {selection.length >= 3 && <DistributeRow selection={selection} />}
      <div className={styles.iconRow} role="group" aria-label="Flip">
        <FlipButtons selection={selection} />
      </div>
    </section>
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
              label="A"
              value={normalizeDegrees(degrees(angleOf(scene.worldTransform(node.id))))}
              onCommit={(value) => setNodesAngle(scene, [node.id], radians(normalizeDegrees(value)))}
            />
            <span className={styles.suffix} aria-hidden="true">
              &deg;
            </span>
          </div>
          <FlipButtons selection={selection} />
        </div>
        <AlignRow selection={selection} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Size</h3>
        <div className={styles.grid}>
          {/*
            * On text, W is editable only once the box is fixed width, where it is the width
            * lines wrap to. H always reports: it is however many lines that produces, and a
            * field that set it would be overwritten by the next keystroke. A hug axis and a
            * fill axis report for the same reason: the number is the layout's answer.
            */}
          <NumberField
            label="W"
            readOnly={
              (node.type === 'text' && node.autoWidth) ||
              // An auto sized component reports its measured box for the same reason a hug
              // axis does: the number is an answer, and a field that set it would be
              // overwritten by the next measurement.
              (node.type === 'component' && node.autoSize) ||
              hugs('width') ||
              fills('width')
            }
            value={node.size.width}
            onCommit={(width) =>
              node.type === 'text'
                ? setTextWidth(node, Math.max(MIN_NODE_SIZE, width))
                : setSize({ ...node.size, width: Math.max(MIN_NODE_SIZE, width) })
            }
          />
          <NumberField
            label="H"
            readOnly={
              node.type === 'text' ||
              (node.type === 'component' && node.autoSize) ||
              hugs('height') ||
              fills('height')
            }
            value={node.size.height}
            onCommit={(height) =>
              setSize({ ...node.size, height: Math.max(MIN_NODE_SIZE, height) })
            }
          />
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Appearance</h3>
        <div className={styles.grid}>
          <div className={styles.suffixed}>
            <NumberField
              label="O"
              value={Math.round(node.opacity * 100)}
              onCommit={(percent) =>
                scene.update(node.id, { opacity: Math.min(1, Math.max(0, percent / 100)) })
              }
            />
            <span className={styles.suffix} aria-hidden="true">
              %
            </span>
          </div>
        </div>
        {(node.type === 'rectangle' || node.type === 'frame') && (
          <CornerRadiiField key={node.id} node={node} />
        )}
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

      {(node.type === 'frame' || inAutoLayout) && (
        <AutoLayoutSection node={node} inAutoLayout={inAutoLayout} />
      )}
      {node.type === 'component' && <ComponentSection node={node} />}
      {node.type === 'text' && <TextSection node={node} />}
      {isPainted(node) && <FillSection node={node} />}
      {/*
        * Text carries strokes because every painted node does, but nothing draws them, so
        * offering the control would be offering a setting with no effect.
        */}
      {isPainted(node) && node.type !== 'text' && <StrokeSection node={node} />}
    </>
  )
}

/**
 * What a field shows for a prop the component declares and gives no default to.
 *
 * Not a value written to the document: nothing is stored until the field is committed, so the
 * component keeps doing whatever it does when it is told nothing.
 */
const EMPTY_FOR: Record<PropKind, string | number | boolean> = {
  text: '',
  number: 0,
  boolean: false,
  select: '',
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
      <div className={styles.headed}>
        {expanded ? (
          <span className={styles.title}>Corners</span>
        ) : (
          <NumberField
            label="R"
            value={node.cornerRadii.topLeft}
            onCommit={(radius) =>
              scene.update<RectangleNode>(node.id, {
                cornerRadii: uniformCornerRadii(Math.max(0, radius)),
              })
            }
          />
        )}
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
        <div className={styles.grid}>
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

const DIRECTIONS = [
  { value: 'horizontal', label: 'Row' },
  { value: 'vertical', label: 'Column' },
] as const satisfies readonly { value: LayoutDirection; label: string }[]

const MAIN_ALIGNS = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'space-between', label: 'Space' },
] as const satisfies readonly { value: LayoutAlign; label: string }[]

const CROSS_ALIGNS = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
] as const satisfies readonly { value: LayoutAlign; label: string }[]

type SizingValue = 'fixed' | 'hug' | 'fill'

/**
 * Auto layout, and now also the per-axis sizing control that used to be four checkboxes
 * split between Size and here (`Hug width/height` in one section, `Fill width/height` in the
 * other). `AxisSizing` (this node's own hug/fixed) and `ChildSizing` (fill/fixed from its
 * parent) are disjoint types on two different objects, so this is where they get unified into
 * one control per axis.
 *
 * Rendered for a plain node too, not just a frame, whenever its parent is an auto layout
 * frame: that node has nothing of its own to configure here beyond Fill, but Fill is exactly
 * the setting this section exists to host.
 */
function AutoLayoutSection({
  node,
  inAutoLayout,
}: {
  node: SceneNode
  inAutoLayout: boolean
}): ReactElement {
  const layout = node.type === 'frame' ? node.layout : undefined

  const modeKey = (axis: keyof Size): 'widthMode' | 'heightMode' =>
    axis === 'width' ? 'widthMode' : 'heightMode'

  const setSizing = (axis: keyof Size, value: SizingValue): void => {
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

  const sizingRow = (axis: keyof Size, label: string): ReactElement | null => {
    const canHug = node.type === 'frame' && layout !== undefined
    // Text height is measured from the text, so it is never anyone's to fill.
    const canFill = inAutoLayout && !(axis === 'height' && node.type === 'text')
    if (!canHug && !canFill) return null

    const options: { value: SizingValue; label: string }[] = [{ value: 'fixed', label: 'Fixed' }]
    if (canHug) options.push({ value: 'hug', label: 'Hug' })
    if (canFill) options.push({ value: 'fill', label: 'Fill' })

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
      <SegmentedField
        key={axis}
        label={label}
        value={value}
        options={options}
        onChange={(next: SizingValue) => setSizing(axis, next)}
      />
    )
  }

  const sizingGrid = (
    <div className={styles.grid}>
      {sizingRow('width', 'W')}
      {sizingRow('height', 'H')}
    </div>
  )

  if (node.type !== 'frame') {
    return (
      <section className={styles.section}>
        <h3 className={styles.title}>Auto layout</h3>
        {sizingGrid}
      </section>
    )
  }

  if (!layout) {
    return (
      <section className={styles.section}>
        <h3 className={styles.title}>Auto layout</h3>
        <button
          type="button"
          className={styles.add}
          onClick={() => addAutoLayout(scene, node.id)}
        >
          Add auto layout
        </button>
        {inAutoLayout && sizingGrid}
      </section>
    )
  }

  const set = (changes: Partial<FrameLayout>): void =>
    updateFrameLayout(scene, node.id, changes)

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Auto layout</h3>
      <div className={styles.headed}>
        <SegmentedField
          label="Flow"
          value={layout.direction}
          options={DIRECTIONS}
          onChange={(direction: LayoutDirection) => set({ direction })}
        />
        <button
          type="button"
          className={styles.remove}
          aria-label="Remove auto layout"
          onClick={() => removeAutoLayout(scene, node.id)}
        >
          &minus;
        </button>
      </div>
      <NumberField
        wide
        label="Gap"
        value={layout.gap}
        onCommit={(gap) => set({ gap: Math.max(0, gap) })}
      />
      {/*
        * The panel edits padding as a horizontal and a vertical pair, which is Figma's own
        * resting shape for it. The model keeps all four sides, so a per side editor can land
        * later without touching the file format.
        */}
      <NumberField
        wide
        label="Pad X"
        value={layout.padding.left}
        onCommit={(value) => {
          const side = Math.max(0, value)
          set({ padding: { ...layout.padding, left: side, right: side } })
        }}
      />
      <NumberField
        wide
        label="Pad Y"
        value={layout.padding.top}
        onCommit={(value) => {
          const side = Math.max(0, value)
          set({ padding: { ...layout.padding, top: side, bottom: side } })
        }}
      />
      <SegmentedField
        label="Align"
        value={layout.mainAlign}
        options={MAIN_ALIGNS}
        onChange={(mainAlign: LayoutAlign) => set({ mainAlign })}
      />
      <SegmentedField
        label="Cross"
        value={layout.crossAlign}
        options={CROSS_ALIGNS}
        onChange={(crossAlign: LayoutAlign) => set({ crossAlign })}
      />
      {sizingGrid}
    </section>
  )
}

/** Below 1 the text is a smudge, and the field's own floor keeps a typo from erasing it. */
/**
 * A component instance: which component it is, and everything it can be told.
 *
 * The fields are built from the registry rather than written out here, so a component that
 * gains a prop gains a row with no change to this file. Every commit goes through
 * `updateComponentProps`, which measures the component at its new props and writes the size
 * in the same transaction, which is what keeps the selection box around a longer label.
 */
function ComponentSection({ node }: { node: ComponentNode }): ReactElement {
  // Adding a prop to the component's type adds a field here, on save, with no reload.
  useLibrary()
  const spec = componentSpec(node.component)

  if (!spec) {
    return (
      <section className={styles.section}>
        <h3 className={styles.title}>Component</h3>
        <p className={styles.empty}>
          This file was saved with a component called &ldquo;{node.component}&rdquo;, which this
          build does not have.
        </p>
      </section>
    )
  }

  const set = (key: string, value: string | number | boolean): void => {
    updateComponentProps(scene, node, { [key]: value })
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>{spec.name}</h3>
      {/* The import a generated file would write. Read only, and the reason these are worth
          calling components rather than widgets. */}
      <p className={styles.source}>{spec.importPath}</p>

      {spec.props.map((prop) => {
        // A prop the component declares but gives no default to still gets a field: the
        // component's own fallback is whatever it does with undefined, and the panel has to
        // show something rather than the word "undefined".
        const value = node.props[prop.key] ?? prop.default ?? EMPTY_FOR[prop.kind]
        if (prop.kind === 'boolean') {
          return (
            <label key={prop.key} className={styles.toggle}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={typeof value === 'boolean' ? value : false}
                onChange={(event) => set(prop.key, event.target.checked)}
              />
              {prop.label}
            </label>
          )
        }
        if (prop.kind === 'select') {
          return (
            <SelectField
              key={prop.key}
              label={prop.label}
              value={String(value)}
              options={prop.options ?? []}
              onChange={(next) => set(prop.key, next)}
            />
          )
        }
        if (prop.kind === 'number') {
          return (
            <NumberField
              key={prop.key}
              wide
              label={prop.label}
              value={typeof value === 'number' ? value : 0}
              onCommit={(next) => set(prop.key, next)}
            />
          )
        }
        return (
          <TextField
            key={prop.key}
            label={prop.label}
            value={String(value)}
            onCommit={(next) => set(prop.key, next)}
          />
        )
      })}

      {/*
        * Dragging a handle sets this, and this is how it comes back off, exactly as Auto
        * width does for a text box. Without it the resize would be a one way door out of a
        * box that keeps up with what the component renders.
        */}
      <label className={styles.toggle}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={node.autoSize}
          onChange={(event) => setComponentAutoSize(scene, node, event.target.checked)}
        />
        Auto size
      </label>
    </section>
  )
}

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
 * One paint of a stack: its colour, its own opacity, whether it draws, and a way out.
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
    <div className={styles.headed}>
      <ColorField
        label={label}
        color={paint.color}
        onChange={(color: RGBA) => onChange({ ...paint, color })}
      />
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
        className={styles.remove}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        &minus;
      </button>
    </div>
  )
}

function FillSection({ node }: { node: PaintedNode }): ReactElement {
  const setFills = (fills: Paint[]): void => {
    scene.update<PaintedNode>(node.id, { fills })
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Fill</h3>
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
      {/*
        * A node without a fill still gets the section, offering one. The wrap frame Shift+A
        * creates is deliberately transparent, and without this it could never stop being so.
        * The new paint goes on top of the stack, which is where Figma puts it and the only
        * end where adding one is visible rather than hidden under what is already there.
        */}
      <button
        type="button"
        className={styles.add}
        onClick={() => setFills([defaultFillFor(node), ...node.fills])}
      >
        Add fill
      </button>
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
      <h3 className={styles.title}>Stroke</h3>
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
      <button
        type="button"
        className={styles.add}
        onClick={() => setStrokes([defaultStroke(), ...node.strokes])}
      >
        Add stroke
      </button>
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
