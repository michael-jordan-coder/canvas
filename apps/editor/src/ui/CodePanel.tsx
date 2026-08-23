import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ComponentNode } from '@figma-canvas/document'
import { parseInstance } from '../code/parseJsx'
import { printInstance } from '../code/printJsx'
import { clearDraft, draftFor, parkDraft } from '../code/drafts'
import { SourceConflictError, readSource, writeSource } from '../code/sourceFile'
import { componentSpec, useLibrary, type ComponentSpec } from '../components/registry'
import { replaceComponentProps } from '../state/componentNodes'
import { scene, useNode } from '../state/scene'
import { useUI } from '../state/uiStore'
import { CodeArea } from './CodeArea'
import { ChevronIcon } from './icons'
import styles from './CodePanel.module.css'

/**
 * The selected component, as code, at one of two levels.
 *
 * **The call site** is printed from the node's props, so it is a view of the *document*:
 * change a prop in the properties panel and this rewrites itself, because the two panels are
 * two renderings of one fact.
 *
 * **The component's own source** is read from disk through the dev server, so it is a view of
 * the *file*. Descending into it is the gesture a design tool already has for going from an
 * instance to its main component.
 *
 * Keeping the two visibly apart is the whole job of this panel's chrome, because they are
 * about to have different write paths: one edits the document, the other edits your repo.
 */
export function CodePanel(): ReactElement {
  const selection = useUI((state) => state.selection)
  const codeComponent = useUI((state) => state.codeComponent)
  const node = useNode(selection.length === 1 ? selection[0] : undefined)
  // Editing a component's props type reprints every call site, since the printer omits values
  // equal to the component's own defaults and those live in the source.
  const revision = useLibrary()

  const spec = codeComponent ? componentSpec(codeComponent) : undefined
  // Keyed by the file, so moving to another component remounts rather than resetting state.
  if (codeComponent && spec) return <SourceCode key={spec.file} spec={spec} revision={revision} />

  if (selection.length > 1) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>Select one component to see its code.</p>
      </div>
    )
  }
  if (!node || node.type !== 'component') {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>Select a component to see its code.</p>
      </div>
    )
  }
  return <InstanceCode node={node} />
}

/**
 * Level one: what this instance would be written as, and a place to write it.
 *
 * A view of the **document**, so it rewrites itself when a prop changes in the Design tab, and
 * committing it writes the document back. That is one undo step, exactly as editing the same
 * prop in a field would be, because it goes through the same measured transaction.
 *
 * The draft is deliberately not parked the way a source file's is. A file draft has no other
 * representation anywhere, so losing it loses the work; a call site is a rendering of props
 * that are still in the document, and it stops meaning anything the moment a different node is
 * selected. So it survives a tab switch, which is the same node, and not a selection change,
 * which is not.
 */
function InstanceCode({ node }: { node: ComponentNode }): ReactElement {
  const spec = componentSpec(node.component)

  if (!spec) {
    return (
      <div className={styles.panel}>
        <header className={styles.header}>
          <span className={styles.name}>{node.component}</span>
        </header>
        <p className={styles.empty}>
          This document names a component called &ldquo;{node.component}&rdquo;, which this build
          does not have, so there is no call site to print.
        </p>
      </div>
    )
  }

  // Keyed by the node, so selecting another instance is a remount and the draft does not
  // follow a call site to a component it was never about.
  return <CallSite key={node.id} node={node} spec={spec} />
}

function CallSite({ node, spec }: { node: ComponentNode; spec: ComponentSpec }): ReactElement {
  const enter = useUI((state) => state.enterComponentSource)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const printed = printInstance(spec, node.props)

  const commit = (): void => {
    if (draft === null) return
    const result = parseInstance(draft, spec)
    if (!result.ok) {
      setError(result.error)
      return
    }
    /*
     * Assigns rather than merges: the tag is the whole statement, so an attribute that is not
     * there is a prop that is not set. See `replaceComponentProps`.
     */
    replaceComponentProps(scene, node, result.props)
    // Dropped rather than kept, so the field goes back to being a view of the document. What
    // it shows next is the reprint, which is not always character for character what was
    // typed: a default written out is dropped, and the attributes come back in declaration
    // order. Showing that is the honest answer, since it is what the document now holds.
    setDraft(null)
    setError(null)
    setSaved(true)
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.name}>{spec.name}</span>
        <button
          type="button"
          className={styles.descend}
          onClick={() => enter(node.id, node.component)}
        >
          {spec.importPath.split('/').pop()}.tsx
          <ChevronIcon />
        </button>
      </header>
      <CodeArea
        label={`${spec.name} call site`}
        value={draft ?? printed}
        onChange={(next) => {
          setDraft(next === printed ? null : next)
          setError(null)
          setSaved(false)
        }}
        onSave={commit}
        onEscape={() => {
          // Nowhere to go from the call site, so Escape means the other thing it means in
          // this editor: throw the edit away. The printed view comes straight back.
          setDraft(null)
          setError(null)
        }}
      />
      {error ? (
        <p className={styles.note} role="alert">
          {error} Nothing was changed.
        </p>
      ) : draft !== null ? (
        <p className={styles.note}>Unsaved. Cmd S applies it to the canvas.</p>
      ) : saved ? (
        <p className={styles.note}>Applied. One undo step, like any other edit.</p>
      ) : (
        /*
         * The document stores scalars, so a prop typed as a callback or an element never
         * reaches it and cannot be printed. Without this line the panel would read as the
         * whole call site while quietly being a part of it.
         */
        <p className={styles.note}>
          The props this document stores. A prop it cannot hold, such as a callback, keeps the
          component&rsquo;s own default.
        </p>
      )}
    </div>
  )
}

/** The text and stamp an edit is measured against: what a read handed over, or a save wrote. */
interface Base {
  text: string
  mtimeMs: number
}

type Status =
  | { kind: 'clean' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string }

/**
 * Level two: the component's own file, read from disk and written back to it.
 *
 * Mounted with a key of the file, so descending into another component is a remount and none
 * of this state has to be reset by hand. What must survive that remount is the unsaved edit,
 * which is why it is parked outside React: see `code/drafts.ts`.
 *
 * A re read triggered by a library change is **ignored while there are unsaved edits**,
 * because replacing the field with what is on disk is exactly the loss the save precondition
 * exists to prevent, and because keeping the old base is what makes the next save a refusal
 * rather than an overwrite.
 */
function SourceCode({ spec, revision }: { spec: ComponentSpec; revision: number }): ReactElement {
  const leave = useUI((state) => state.leaveComponentSource)
  const parked = draftFor(spec.file)
  const [base, setBase] = useState<Base | null>(parked?.base ?? null)
  const [failure, setFailure] = useState<string | null>(null)
  /** What is in the field when it differs from the base. Null means it does not. */
  const [draft, setDraft] = useState<string | null>(parked?.text ?? null)
  const [status, setStatus] = useState<Status>({ kind: 'clean' })

  const dirty = draft !== null
  // Read by an effect that must not re-run when it changes, which is what a ref is for.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    let current = true
    // Also covers the mount that picked a parked draft up: what is on disk is not what the
    // field should show, and the base the draft was typed against is the one to save against.
    if (dirtyRef.current) return
    void readSource(spec.file)
      .then((source) => {
        if (!current) return
        setBase({ text: source.text, mtimeMs: source.mtimeMs })
        setFailure(null)
      })
      .catch((cause: unknown) => {
        if (!current) return
        setBase(null)
        setFailure(cause instanceof Error ? cause.message : 'Could not read it.')
      })
    return () => {
      // The panel can move to another component while a read is in flight, and the answer to
      // the question nobody is asking any more must not land in the field.
      current = false
    }
  }, [spec.file, revision])

  const edit = (next: string): void => {
    if (!base) return
    if (next === base.text) {
      setDraft(null)
      clearDraft(spec.file)
    } else {
      setDraft(next)
      parkDraft(spec.file, { text: next, base })
    }
    // A status is about the last save, and typing makes it about nothing. A conflict survives,
    // because it is about the file rather than about the attempt, and it is still true.
    if (status.kind !== 'conflict') setStatus({ kind: 'clean' })
  }

  const save = (): void => {
    if (!base || draft === null || status.kind === 'saving') return
    const text = draft
    setStatus({ kind: 'saving' })
    void writeSource(spec.file, text, base.mtimeMs)
      .then((stamp) => {
        // The field is the truth now, so what the next edit is measured against is what was
        // just written rather than what the re read is about to bring back.
        setBase({ text, mtimeMs: stamp.mtimeMs })
        setDraft(null)
        clearDraft(spec.file)
        setStatus({ kind: 'saved' })
      })
      .catch((cause: unknown) => {
        // Nothing typed is touched by a failure. The edit stays in the field, and parked.
        if (cause instanceof SourceConflictError) setStatus({ kind: 'conflict' })
        else {
          setStatus({
            kind: 'error',
            message: cause instanceof Error ? cause.message : 'Could not write it.',
          })
        }
      })
  }

  /** Throws the edit away and takes what is on disk. The way out of a conflict. */
  const reload = (): void => {
    setDraft(null)
    clearDraft(spec.file)
    setStatus({ kind: 'clean' })
    void readSource(spec.file)
      .then((source) => setBase({ text: source.text, mtimeMs: source.mtimeMs }))
      .catch(() => setFailure('Could not read it.'))
  }

  const fileName = `${spec.importPath.split('/').pop() ?? spec.name}.tsx`

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={leave} aria-label="Back to the call site">
          <ChevronIcon />
          {spec.name}
        </button>
        <span className={styles.name}>{fileName}</span>
        <span className={styles.source}>{spec.importPath}</span>
      </header>
      {failure ? (
        <p className={styles.empty} role="alert">
          {failure}
        </p>
      ) : (
        <CodeArea
          label={`${fileName} source`}
          value={draft ?? base?.text ?? ''}
          readOnly={!base}
          onChange={edit}
          onSave={save}
          onEscape={leave}
        />
      )}
      <StatusNote dirty={dirty} status={status} fileName={fileName} onReload={reload} />
    </div>
  )
}

/**
 * What the file is doing, in the line the call site uses for its footnote.
 *
 * A conflict is the only one that offers a control, because it is the only one where the
 * editor cannot decide for you: what is in the field and what is on disk are both real.
 */
function StatusNote({
  dirty,
  status,
  fileName,
  onReload,
}: {
  dirty: boolean
  status: Status
  fileName: string
  onReload: () => void
}): ReactElement {
  if (status.kind === 'conflict') {
    return (
      <p className={styles.note} role="alert">
        {fileName} changed on disk since it was opened here, so it was not written. Your edit is
        still in the field.{' '}
        <button type="button" className={styles.inline} onClick={onReload}>
          Discard it and reload
        </button>
      </p>
    )
  }
  if (status.kind === 'error') {
    return (
      <p className={styles.note} role="alert">
        {status.message} Your edit is still in the field.
      </p>
    )
  }
  if (status.kind === 'saving') return <p className={styles.note}>Writing {fileName}.</p>
  if (dirty) return <p className={styles.note}>Unsaved. Cmd S writes the file.</p>
  if (status.kind === 'saved') return <p className={styles.note}>Saved to {fileName}.</p>
  return <p className={styles.note}>The file on disk. Cmd S writes it back.</p>
}
