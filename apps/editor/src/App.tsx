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
import { LayersPanel } from './ui/LayersPanel'
import { PerfReadout } from './ui/PerfReadout'
import { PropertiesPanel } from './ui/PropertiesPanel'
import { Toolbar } from './ui/Toolbar'
import styles from './App.module.css'

/** Read once: it comes from the URL and cannot change without a reload. */
const showStats = showStatsFromLocation()

export function App(): ReactElement {
  // Window level, not canvas level: undo and paste should work with the pointer over a panel.
  useEffect(() => {
    const wiring = {
      document: scene,
      getSelection: () => useUI.getState().selection,
      setSelection: (ids: readonly NodeId[]) => useUI.getState().setSelection(ids),
      setTool: selectTool,
      getMode: () => useUI.getState().mode,
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
      <div className={styles.body}>
        <div className={styles.sidebar}>
          <ComponentsPanel />
          <LayersPanel />
        </div>
        <main className={styles.viewport}>
          <CanvasHost />
          {showStats && <PerfReadout />}
        </main>
        <PropertiesPanel />
      </div>
    </div>
  )
}
