import { useEffect, useState, type ReactElement } from 'react'
import type { ComponentNode } from '@figma-canvas/document'
import { printInstance } from '../code/printJsx'
import { readSource } from '../code/sourceFile'
import { componentSpec, useLibrary, type ComponentSpec } from '../components/registry'
import { useNode } from '../state/scene'
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
  if (codeComponent && spec) return <SourceCode spec={spec} revision={revision} />

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

/** Level one: what this instance would be written as, from what the document holds. */
function InstanceCode({ node }: { node: ComponentNode }): ReactElement {
  const enter = useUI((state) => state.enterComponentSource)
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
      <CodeArea label={`${spec.name} call site`} value={printInstance(spec, node.props)} readOnly />
      {/*
        * The document stores scalars, so a prop typed as a callback or an element never reaches
        * it and cannot be printed. Without this line the panel would read as the whole call
        * site while quietly being a part of it.
        */}
      <p className={styles.note}>
        The props this document stores. A prop it cannot hold, such as a callback, keeps the
        component&rsquo;s own default.
      </p>
    </div>
  )
}

interface Loaded {
  text: string
  error: string | null
}

/**
 * Level two: the component's own file.
 *
 * Re-read whenever the library changes, which covers both an edit made here and one made in
 * an ordinary editor, since both arrive as the same hot update.
 */
function SourceCode({ spec, revision }: { spec: ComponentSpec; revision: number }): ReactElement {
  const leave = useUI((state) => state.leaveComponentSource)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let current = true
    setLoaded(null)
    void readSource(spec.file)
      .then((source) => {
        if (current) setLoaded({ text: source.text, error: null })
      })
      .catch((cause: unknown) => {
        if (!current) return
        setLoaded({ text: '', error: cause instanceof Error ? cause.message : 'Could not read it.' })
      })
    return () => {
      // The panel can move to another component while a read is in flight, and the answer to
      // the question nobody is asking any more must not land in the field.
      current = false
    }
  }, [spec.file, revision])

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
      {loaded?.error ? (
        <p className={styles.empty} role="alert">
          {loaded.error}
        </p>
      ) : (
        <CodeArea
          label={`${fileName} source`}
          value={loaded?.text ?? ''}
          readOnly
          onEscape={leave}
        />
      )}
      <p className={styles.note}>Read from disk. Editing it comes next.</p>
    </div>
  )
}
