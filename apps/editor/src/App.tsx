import type { ReactElement } from 'react'
import { CanvasHost } from './canvas/CanvasHost'
import { LayersPanel } from './ui/LayersPanel'
import { PropertiesPanel } from './ui/PropertiesPanel'
import { Toolbar } from './ui/Toolbar'
import styles from './App.module.css'

export function App(): ReactElement {
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
