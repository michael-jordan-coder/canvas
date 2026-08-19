import type { ReactElement } from 'react'
import {
  angleOf,
  degrees,
  fromHex,
  isPainted,
  normalizeDegrees,
  radians,
  type FrameNode,
  type PaintedNode,
  type RectangleNode,
  type RGBA,
  type SceneNode,
  type Stroke,
  type StrokeAlign,
  type TextNode,
} from '@figma-canvas/document'
import { scene, useNode } from '../state/scene'
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

function NodeProperties({ node }: { node: SceneNode }): ReactElement {
  return (
    <div className={styles.sections}>
      <section className={styles.section}>
        <h3 className={styles.title}>Position</h3>
        <div className={styles.grid}>
          <NumberField
            label="X"
            value={node.transform.tx}
            onCommit={(tx) => scene.update(node.id, { transform: { ...node.transform, tx } })}
          />
          <NumberField
            label="Y"
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
            * field that set it would be overwritten by the next keystroke.
            */}
          <NumberField
            label="W"
            readOnly={node.type === 'text' && node.autoWidth}
            value={node.size.width}
            onCommit={(width) =>
              node.type === 'text'
                ? setTextWidth(node, Math.max(MIN_NODE_SIZE, width))
                : scene.update(node.id, {
                    size: { ...node.size, width: Math.max(MIN_NODE_SIZE, width) },
                  })
            }
          />
          <NumberField
            label="H"
            readOnly={node.type === 'text'}
            value={node.size.height}
            onCommit={(height) =>
              scene.update(node.id, {
                size: { ...node.size, height: Math.max(MIN_NODE_SIZE, height) },
              })
            }
          />
        </div>
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

function FillSection({ node }: { node: PaintedNode }): ReactElement | null {
  const fill = node.fills[0]
  if (!fill) return null

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Fill</h3>
      <ColorField
        label="Fill"
        color={fill.color}
        onChange={(color: RGBA) =>
          scene.update<PaintedNode>(node.id, { fills: [{ type: 'solid', color }] })
        }
      />
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
