import type { ReactElement } from 'react'
import type { LayoutAlign, LayoutDirection } from '@canvas/document'
import styles from './AlignmentGrid.module.css'

const PACKED = ['start', 'center', 'end'] as const
type Packed = (typeof PACKED)[number]

const ROW_WORDS: Record<Packed, string> = { start: 'top', center: 'middle', end: 'bottom' }
const COLUMN_WORDS: Record<Packed, string> = { start: 'left', center: 'center', end: 'right' }

interface AlignmentGridProps {
  direction: LayoutDirection
  mainAlign: LayoutAlign
  crossAlign: LayoutAlign
  onChange: (align: { mainAlign: LayoutAlign; crossAlign: LayoutAlign }) => void
}

/**
 * The nine ways children can sit in an auto layout frame, shown as the frame itself: a
 * 3x3 field where the chosen cell draws the children as bars and every other cell is a
 * dot. One click sets both alignments at once, which two separate segmented rows made
 * into a mapping exercise.
 *
 * With space between, the main axis has no packed position, so the whole selected cross
 * line lights up one bar per cell and a click moves only the cross alignment.
 */
export function AlignmentGrid({
  direction,
  mainAlign,
  crossAlign,
  onChange,
}: AlignmentGridProps): ReactElement {
  const spaced = mainAlign === 'space-between'

  const cells: ReactElement[] = []
  for (const row of PACKED) {
    for (const column of PACKED) {
      // The grid is drawn in screen axes; the layout speaks in main and cross. A row frame
      // runs its main axis along the grid's columns, a column frame down its rows.
      const main = direction === 'horizontal' ? column : row
      const cross = direction === 'horizontal' ? row : column
      const selected = cross === crossAlign && (spaced || main === mainAlign)
      const label = `Align ${ROW_WORDS[row]} ${COLUMN_WORDS[column]}`

      cells.push(
        <button
          key={`${row}-${column}`}
          type="button"
          className={selected ? `${styles.cell} ${styles.selected}` : styles.cell}
          aria-label={label}
          aria-pressed={selected}
          title={label}
          onClick={() =>
            onChange(
              spaced
                ? { mainAlign: 'space-between', crossAlign: cross }
                : { mainAlign: main, crossAlign: cross },
            )
          }
        >
          {selected ? (
            <span
              className={
                direction === 'horizontal'
                  ? `${styles.glyph} ${styles.horizontal}`
                  : `${styles.glyph} ${styles.vertical}`
              }
              aria-hidden="true"
            >
              <span className={styles.bar} />
              {!spaced && <span className={styles.bar} />}
              {!spaced && <span className={styles.bar} />}
            </span>
          ) : (
            <span className={styles.dot} aria-hidden="true" />
          )}
        </button>,
      )
    }
  }

  return (
    <div className={styles.grid} role="group" aria-label="Alignment">
      {cells}
    </div>
  )
}
