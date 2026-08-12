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
} from '@figma-canvas/document'
import { scene, useNode } from '../state/scene'
import { setNodesAngle } from '../state/rotate'
import { useUI } from '../state/uiStore'
import { ColorField } from './ColorField'
import { NumberField } from './NumberField'
import { SegmentedField } from './SegmentedField'
import styles from './PropertiesPanel.module.css'

export function PropertiesPanel(): ReactElement {
  const selection = useUI((state) => state.selection)
  const node = useNode(selection.length === 1 ? selection[0] : undefined)

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>{node ? node.name : 'Properties'}</header>
      {node && <NodeProperties node={node} />}
    </aside>
  )
}

function NodeProperties({ node }: { node: SceneNode }): ReactElement {
  return (
    <div className={styles.sections}>
      <section className={styles.grid}>
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
        <NumberField
          label="W"
          value={node.size.width}
          onCommit={(width) => scene.update(node.id, { size: { ...node.size, width } })}
        />
        <NumberField
          label="H"
          value={node.size.height}
          onCommit={(height) => scene.update(node.id, { size: { ...node.size, height } })}
        />
      </section>

      <section className={styles.grid}>
        <NumberField
          label="A"
          value={normalizeDegrees(degrees(angleOf(scene.worldTransform(node.id))))}
          onCommit={(value) => setNodesAngle(scene, [node.id], radians(value))}
        />
        <NumberField
          label="%"
          value={Math.round(node.opacity * 100)}
          onCommit={(percent) =>
            scene.update(node.id, { opacity: Math.min(1, Math.max(0, percent / 100)) })
          }
        />
        {(node.type === 'rectangle' || node.type === 'frame') && (
          <NumberField
            label="R"
            value={node.cornerRadius}
            onCommit={(cornerRadius) =>
              scene.update<RectangleNode>(node.id, { cornerRadius: Math.max(0, cornerRadius) })
            }
          />
        )}
      </section>

      {node.type === 'frame' && (
        <section className={styles.stack}>
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
        </section>
      )}

      {isPainted(node) && <FillSection node={node} />}
      {isPainted(node) && <StrokeSection node={node} />}
    </div>
  )
}

function FillSection({ node }: { node: PaintedNode }): ReactElement | null {
  const fill = node.fills[0]
  if (!fill) return null

  return (
    <section className={styles.stack}>
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
      <section className={styles.stack}>
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
    <section className={styles.stack}>
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
