/**
 * What a code node's run produces: a tree of plain descriptions, one per node the editor
 * will instantiate. This is the whole contract between running code and the document, and it
 * is deliberately data all the way down, because it crosses a Web Worker boundary by
 * structured clone. A function cannot ride along, which is why events travel as flags and
 * the handlers stay behind in the worker.
 *
 * Prop names are the web's, not the canvas's: `gap`, `padding`, `background`,
 * `borderRadius`, `direction: 'row'`. That is a hard requirement rather than a taste,
 * because the code written against these props has to translate to real React later, and
 * every prop here is chosen to have a direct CSS equivalent. The instantiator owns the
 * mapping into canvas vocabulary.
 */

/** The primitives code can emit. Deliberately no 'code': output cannot nest generators. */
export type CodeElementType = 'frame' | 'rectangle' | 'ellipse' | 'text'

/** The pointer events an element can ask for. Names are React's, for the same reason. */
export interface CodeElementEvents {
  click?: true
  pointerDown?: true
  pointerUp?: true
  pointerEnter?: true
  pointerLeave?: true
}

export interface CodeElementProps {
  /** Position inside the parent, ignored when the parent lays its children out. */
  x?: number
  y?: number
  /** Absent on a laid-out frame means hug, on text means size-to-words. */
  width?: number
  height?: number
  /** Hex, `#rrggbb`. Alpha travels as `opacity`, which is what the validator enforces. */
  background?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?:
    | number
    | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }
  opacity?: number
  /** `hidden` clips children to the frame's geometry, exactly `clipsContent`. */
  overflow?: 'visible' | 'hidden'
  /** Presence of any flex prop makes the frame lay its children out. */
  direction?: 'row' | 'column'
  gap?: number
  padding?: number | { top: number; right: number; bottom: number; left: number }
  /** `align-items`, the cross axis. */
  align?: 'start' | 'center' | 'end'
  /** `justify-content`, the main axis. */
  justify?: 'start' | 'center' | 'end' | 'space-between'
  /** `flex-grow`: fill the parent's main axis instead of holding its own size. */
  grow?: boolean
  /** Text only. */
  fontSize?: number
  color?: string
}

export interface CodeElement {
  type: CodeElementType
  /**
   * The element's key path from the root, '/'-joined, an unkeyed child contributing its
   * index. This is the identity that survives a re-run: a node instantiated from an element
   * keeps the path as its `sourceKey`, and the reconciler matches on it, so a keyed list can
   * reorder without its nodes being rebuilt. The same rule React's keys state, applied to
   * scene nodes.
   */
  id: string
  key?: string
  name?: string
  props: CodeElementProps
  /** Which handlers the element declared. The functions themselves stay in the worker. */
  events?: CodeElementEvents
  /** Text content, `text` elements only. */
  text?: string
  children?: CodeElement[]
}
