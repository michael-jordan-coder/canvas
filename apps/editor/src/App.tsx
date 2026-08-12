import { useEffect, type ReactElement } from 'react'
import { CanvasHost } from './canvas/CanvasHost'
import { createKeyboardInput } from './input/keyboardInput'
import { scene } from './state/scene'
import { useUI } from './state/uiStore'
import { LayersPanel } from './ui/LayersPanel'
import { PropertiesPanel } from './ui/PropertiesPanel'
import { Toolbar } from './ui/Toolbar'
import styles from './App.module.css'

export function App(): ReactElement {
  // Window level, not canvas level: undo should work with the pointer over a panel.
  useEffect(
    () =>
      createKeyboardInput({
        document: scene,
        getSelection: () => useUI.getState().selection,
        setSelection: (ids) => useUI.getState().setSelection(ids),
      }),
    [],
  )

  return (
    <div className={styles.app}>
      <Toolbar />
      <div className={styles.body}>
        <LayersPanel />
        <main className={styles.viewport}>
          <CanvasHost />
        </main>
        <PropertiesPanel />
      </div>
    </div>
  )
}
