import { useEffect, type ReactElement } from 'react'
import type { NodeId } from '@canvas/document'
import { createAgentConnection } from './agent/connection'
import { CanvasHost } from './canvas/CanvasHost'
import { createClipboardInput } from './input/clipboardInput'
import { createKeyboardInput } from './input/keyboardInput'
import { scene } from './state/scene'
// Measures every text node once the font arrives. Imported for that effect.
import './state/font'
import { rerunAllCodeNodes } from './state/code'
import { startTranscriptAutosave } from './agent/chatStorage'
import { selectTool } from './state/textEditing'
import { useUI } from './state/uiStore'
import { showStatsFromLocation } from './state/stats'
import { startPanelFollow } from './state/panelFollow'
import { LayersPanel } from './ui/LayersPanel'
import { PerfReadout } from './ui/PerfReadout'
import { RightPanel } from './ui/RightPanel'
import { Toolbar } from './ui/Toolbar'
import styles from './App.module.css'

/** Read once: it comes from the URL and cannot change without a reload. */
const showStats = showStatsFromLocation()

// The loaded document's code nodes run once at startup. Here rather than in `state/scene`,
// because the scene module runs its load at import time and the code door imports the scene:
// calling back into it mid-initialisation would be a cycle with a half-built module in it.
rerunAllCodeNodes()

export function App(): ReactElement {
  // Window level, not canvas level: undo and paste should work with the pointer over a panel.
  useEffect(() => {
    const wiring = {
      document: scene,
      getSelection: () => useUI.getState().selection,
      setSelection: (ids: readonly NodeId[]) => useUI.getState().setSelection(ids),
      setTool: selectTool,
    }
    const disposeKeyboard = createKeyboardInput(wiring)
    const disposeClipboard = createClipboardInput(wiring)
    const disposeAgent = createAgentConnection()
    const disposeTranscript = startTranscriptAutosave()
    const disposePanelFollow = startPanelFollow()
    return () => {
      disposeKeyboard()
      disposeClipboard()
      disposeAgent()
      disposeTranscript()
      disposePanelFollow()
    }
  }, [])

  return (
    <div className={styles.app}>
      <LayersPanel />
      <main className={styles.viewport}>
        <CanvasHost />
        {showStats && <PerfReadout />}
      </main>
      <RightPanel />
      {/* A sibling of the columns rather than a child of one. It is `position: fixed`, so it
          belongs to the window and takes no grid track; nesting it in the viewport would say
          it belongs to the canvas column, and would hand its containing block to anything
          that ever puts a transform or a filter on that column. */}
      <Toolbar />
    </div>
  )
}
