import { useEffect, useState, type ReactElement } from 'react'
import { frameStats } from '../state/stats'
import styles from './PerfReadout.module.css'

/** Four times a second. Reading per frame would make this a measurement of React. */
const INTERVAL = 250

export function PerfReadout(): ReactElement {
  const [shown, setShown] = useState({ ...frameStats })

  useEffect(() => {
    const timer = setInterval(() => setShown({ ...frameStats }), INTERVAL)
    return () => clearInterval(timer)
  }, [])

  const fps = shown.intervalMs > 0 ? Math.round(1000 / shown.intervalMs) : 0

  return (
    <dl className={styles.readout}>
      <dt>drawn</dt>
      <dd>{shown.instances.toLocaleString()}</dd>
      <dt>culled</dt>
      <dd>{shown.culled.toLocaleString()}</dd>
      <dt>build</dt>
      <dd>{shown.syncMs.toFixed(2)}ms</dd>
      <dt>frame</dt>
      <dd>{shown.frameMs.toFixed(2)}ms</dd>
      <dt>rate</dt>
      <dd>{fps > 0 ? `${fps}/s` : '-'}</dd>
    </dl>
  )
}
