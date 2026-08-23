import { useEffect, type ReactElement } from 'react'
import type { NodeId } from '@figma-canvas/document'
import { CanvasHost } from './canvas/CanvasHost'
import { createClipboardInput } from './input/clipboardInput'
import { createKeyboardInput } from './input/keyboardInput'
import { scene } from './state/scene'
// Measures every text node once the font arrives. Imported for that effect.
import './state/font'
// Joins the text and component measurers and hands them to auto layout, then measures every
// component in the loaded document. Also imported for its effect, and after the font module
// because it reads the text half from it.
import './state/measure'
import { selectTool } from './state/textEditing'
import { useUI } from './state/uiStore'
import { showStatsFromLocation } from './state/stats'
import { ComponentsPanel } from './ui/ComponentsPanel'
import { Inspector } from './ui/Inspector'
import { LayersPanel } from './ui/LayersPanel'
import { PerfReadout } from './ui/PerfReadout'
import { Toolbar } from './ui/Toolbar'
import styles from './App.module.css'

/** Read once: it comes from the URL and cannot change without a reload. */
const showStats = showStatsFromLocation()

export function App(): ReactElement {
  // The only thing the shell reads from the store: which face the inspector is showing, so the
  // grid can give that column the room code needs.
  const inspector = useUI((state) => state.inspector)

  // Window level, not canvas level: undo and paste should work with the pointer over a panel.
  useEffect(() => {
    const wiring = {
      document: scene,
      getSelection: () => useUI.getState().selection,
      setSelection: (ids: readonly NodeId[]) => useUI.getState().setSelection(ids),
      setTool: selectTool,
      getMode: () => useUI.getState().mode,
      enterComponentSource: (id: NodeId, component: string) =>
        useUI.getState().enterComponentSource(id, component),
    }
    const disposeKeyboard = createKeyboardInput(wiring)
    const disposeClipboard = createClipboardInput(wiring)
    return () => {
      disposeKeyboard()
      disposeClipboard()
    }
  }, [])

  return (
    <div className={styles.app}>
      <Toolbar />
      <div className={styles.body} data-inspector={inspector}>
        <div className={styles.sidebar}>
          <ComponentsPanel />
          <LayersPanel />
        </div>
        <main className={styles.viewport}>
          <CanvasHost />
          {showStats && <PerfReadout />}
        </main>
        <Inspector />
      </div>
    </div>
  )
}
