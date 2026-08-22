import type { ReactElement } from 'react'
import {
  angleOf,
  degrees,
  fromHex,
  isAutoLayoutFrame,
  isPainted,
  normalizeDegrees,
  radians,
  type FrameLayout,
  type FrameNode,
  type LayoutAlign,
  type LayoutDirection,
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
import {
  addAutoLayout,
  relayout,
  removeAutoLayout,
  updateFrameLayout,
  updateLayoutChild,
} from '../state/autoLayout'
import { updateText } from '../state/font'
import { setNodesAngle } from '../state/rotate'
import { useUI } from '../state/uiStore'
import { MIN_NODE_SIZE } from '../input/resize'
import { ColorField } from './ColorField'
import { NumberField } from './NumberField'
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
      <header className={styles.header}>{title}</header>
      {node && <NodeProperties node={node} />}
      {selection.length === 0 && <p className={styles.empty}>Nothing selected</p>}
    </aside>
  )
}

/** Which of the frame's sizing slots a panel axis is, given the direction. */
function sizingKey(
  layout: FrameLayout,
  axis: keyof Size,
): 'mainSizing' | 'crossSizing' {
  const isMain = (axis === 'width') === (layout.direction === 'horizontal')
  return isMain ? 'mainSizing' : 'crossSizing'
}

function NodeProperties({ node }: { node: SceneNode }): ReactElement {
  // The parent decides whether position and size belong to a layout, and its own layout can
  // change under a still selected child, so the panel subscribes to it too.
  const parent = useNode(node.parent ?? undefined)
  const inAutoLayout = isAutoLayoutFrame(parent)
  const layout = node.type === 'frame' ? node.layout : undefined

  const setSize = (size: Size): void => {
    scene.transact(() => {
      scene.update(node.id, { size })
      relayout(scene, [node.id])
    })
  }

  const hugs = (axis: keyof Size): boolean =>
    layout !== undefined && layout[sizingKey(layout, axis)] === 'hug'
  const fills = (axis: keyof Size): boolean =>
    inAutoLayout &&
    (axis === 'width' ? node.layoutChild?.widthMode : node.layoutChild?.heightMode) === 'fill'

  return (
    <div className={styles.sections}>
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
        </div>
        {layout && (
          <>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={hugs('width')}
                onChange={(event) =>
                  updateFrameLayout(scene, node.id, {
                    [sizingKey(layout, 'width')]: event.target.checked ? 'hug' : 'fixed',
                  })
                }
              />
              Hug width
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={hugs('height')}
                onChange={(event) =>
                  updateFrameLayout(scene, node.id, {
                    [sizingKey(layout, 'height')]: event.target.checked ? 'hug' : 'fixed',
                  })
                }
              />
              Hug height
            </label>
          </>
        )}
        {inAutoLayout && (
          <>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={fills('width')}
                onChange={(event) =>
                  updateLayoutChild(scene, node, {
                    widthMode: event.target.checked ? 'fill' : 'fixed',
                  })
                }
              />
              Fill width
            </label>
            {/* Text height is measured from the text, so it is never anyone's to fill. */}
            {node.type !== 'text' && (
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={fills('height')}
                  onChange={(event) =>
                    updateLayoutChild(scene, node, {
                      heightMode: event.target.checked ? 'fill' : 'fixed',
                    })
                  }
                />
                Fill height
              </label>
            )}
          </>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.title}>Appearance</h3>
        <div className={styles.grid}>
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
          {(node.type === 'rectangle' || node.type === 'frame') && (
            <NumberField
              label="R"
              value={node.cornerRadius}
              onCommit={(cornerRadius) =>
                scene.update<RectangleNode>(node.id, { cornerRadius: Math.max(0, cornerRadius) })
              }
            />
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
    </div>
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

function AutoLayoutSection({ node }: { node: FrameNode }): ReactElement {
  const layout = node.layout

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

function FillSection({ node }: { node: PaintedNode }): ReactElement {
  const fill = node.fills[0]

  if (!fill) {
    // A node without a fill still gets the section, offering one. The wrap frame Shift+A
    // creates is deliberately transparent, and without this it could never stop being so.
    return (
      <section className={styles.section}>
        <h3 className={styles.title}>Fill</h3>
        <button
          type="button"
          className={styles.add}
          onClick={() => scene.update<PaintedNode>(node.id, { fills: [defaultFillFor(node)] })}
        >
          Add fill
        </button>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Fill</h3>
      <div className={styles.headed}>
        <ColorField
          label="Fill"
          color={fill.color}
          onChange={(color: RGBA) =>
            scene.update<PaintedNode>(node.id, { fills: [{ type: 'solid', color }] })
          }
        />
        <button
          type="button"
          className={styles.remove}
          aria-label="Remove fill"
          onClick={() => scene.update<PaintedNode>(node.id, { fills: [] })}
        >
          &minus;
        </button>
      </div>
    </section>
  )
}

/** Figma's own default: a one unit line just inside the edge, so the footprint does not move. */
const DEFAULT_STROKE: Stroke = { paint: fromHex('#1a1a1a'), weight: 1, align: 'inside' }

const ALIGNMENTS = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' },
] as const satisfies readonly { value: StrokeAlign; label: string }[]

function StrokeSection({ node }: { node: PaintedNode }): ReactElement {
  const stroke = node.strokes[0]

  const set = (next: Partial<Stroke>): void => {
    scene.update<PaintedNode>(node.id, { strokes: [{ ...(stroke ?? DEFAULT_STROKE), ...next }] })
  }

  if (!stroke) {
    return (
      <section className={styles.section}>
        <h3 className={styles.title}>Stroke</h3>
        <button
          type="button"
          className={styles.add}
          onClick={() => scene.update<PaintedNode>(node.id, { strokes: [DEFAULT_STROKE] })}
        >
          Add stroke
        </button>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Stroke</h3>
      <div className={styles.headed}>
        <ColorField
          label="Stroke"
          color={stroke.paint.color}
          onChange={(color: RGBA) => set({ paint: { type: 'solid', color } })}
        />
        <button
          type="button"
          className={styles.remove}
          aria-label="Remove stroke"
          onClick={() => scene.update<PaintedNode>(node.id, { strokes: [] })}
        >
          &minus;
        </button>
      </div>
      <SegmentedField
        label="Align"
        value={stroke.align}
        options={ALIGNMENTS}
        onChange={(align: StrokeAlign) => set({ align })}
      />
      <NumberField
        wide
        label="Weight"
        value={stroke.weight}
        onCommit={(weight) => set({ weight: Math.max(0, weight) })}
      />
    </section>
  )
}
