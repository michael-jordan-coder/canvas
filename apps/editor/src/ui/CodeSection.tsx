import { useEffect, useRef, useState, type ReactElement } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import type { CodeNode, JsonValue } from '@canvas/document'
import { beginPlay, endPlay, updateCodeProps, updateCodeSource, useCodeStatus } from '../state/code'
import { useUI } from '../state/uiStore'
import { PlayIcon, StopIcon } from './icons'
import styles from './CodeSection.module.css'
import panel from './PropertiesPanel.module.css'

/** Long enough to finish a thought, short enough that the canvas feels attached to the keys. */
const RUN_IDLE_MS = 400

/**
 * The code node's panel: the source in a CodeMirror editor, the props as JSON, the last
 * run's error, and Play. The editor is uncontrolled the way the text editor's textarea is,
 * and for the same reason: a controlled mirror of every keystroke would fight the editor's
 * own transactions. The document's source is written on idle, on blur and on Cmd+Enter,
 * through the one door in `state/code.ts`.
 */
export function CodeSection({ node }: { node: CodeNode }): ReactElement {
  const error = useCodeStatus((state) => state.errors.get(node.id))
  const playing = useUI((state) => state.play) === node.id
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  /** The last source this panel itself committed, so an echo is not treated as external. */
  const committed = useRef(node.source)
  const timer = useRef<number | undefined>(undefined)

  const commit = (): void => {
    window.clearTimeout(timer.current)
    const editor = view.current
    if (!editor) return
    const text = editor.state.doc.toString()
    if (text === committed.current) return
    committed.current = text
    updateCodeSource(node.id, text)
  }

  useEffect(() => {
    const parent = host.current
    if (!parent || playing) return undefined

    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: node.source,
        extensions: [
          lineNumbers(),
          history(),
          javascript({ jsx: true, typescript: true }),
          keymap.of([
            // Before the defaults, so Mod-Enter means run rather than insert-line.
            { key: 'Mod-Enter', run: () => { commit(); return true } },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(commit, RUN_IDLE_MS)
          }),
          EditorView.domEventHandlers({ blur: () => { commit(); return false } }),
        ],
      }),
    })
    view.current = editor
    committed.current = node.source

    return () => {
      // Whatever is still pending goes with the section, not into the void: deselecting the
      // node mid-thought must not lose the last few keystrokes.
      commit()
      window.clearTimeout(timer.current)
      editor.destroy()
      view.current = null
    }
    // Recreated per node and per play state; the editor holds its own doc between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, playing])

  /*
   * An edit that arrived from outside this panel: undo, the agent, a loaded file. The guard
   * against echo is the committed ref, since our own commit comes back as a node change too.
   */
  useEffect(() => {
    const editor = view.current
    if (!editor || node.source === committed.current) return
    committed.current = node.source
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: node.source },
    })
  }, [node.source])

  return (
    <section className={panel.section}>
      <div className={panel.sectionHeader}>
        <h3 className={panel.title}>Code</h3>
        <button
          type="button"
          className={panel.iconButton}
          aria-label={playing ? 'Stop the prototype' : 'Play the prototype'}
          aria-pressed={playing}
          onClick={() => (playing ? endPlay() : beginPlay(node.id))}
        >
          {playing ? <StopIcon size={14} /> : <PlayIcon size={14} />}
        </button>
      </div>
      {playing ? (
        <p className={styles.playing}>Playing. Stop to edit the source.</p>
      ) : (
        /* Keystrokes stay in the editor: the window-level shortcuts already ignore a
           contenteditable target, this keeps anything else from ever seeing them. */
        <div
          className={styles.editor}
          ref={host}
          onKeyDown={(event) => event.stopPropagation()}
        />
      )}
      {error !== undefined && <p className={styles.error}>{error}</p>}
      <PropsField key={node.id} node={node} />
    </section>
  )
}

/**
 * The props record as editable JSON. A draft that does not parse shows what is wrong and
 * writes nothing, the serialize.ts stance applied to a text field.
 */
function PropsField({ node }: { node: CodeNode }): ReactElement {
  const [draft, setDraft] = useState(() => JSON.stringify(node.props, null, 2))
  const [problem, setProblem] = useState<string | null>(null)

  const commit = (): void => {
    try {
      const parsed: unknown = JSON.parse(draft)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setProblem('props must be a JSON object')
        return
      }
      setProblem(null)
      updateCodeProps(node.id, parsed as Record<string, JsonValue>)
    } catch {
      setProblem('not valid JSON')
    }
  }

  return (
    <label className={styles.props}>
      <span className={styles.propsLabel}>Props</span>
      <textarea
        className={styles.propsInput}
        value={draft}
        rows={3}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.stopPropagation()}
      />
      {problem && <span className={styles.error}>{problem}</span>}
    </label>
  )
}
