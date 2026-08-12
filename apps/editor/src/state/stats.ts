/**
 * Per frame numbers, written by the canvas host and read by the readout on a timer.
 *
 * A plain mutable object rather than a store on purpose: this is written on every frame of
 * a drag, and pushing it through React state would make measuring the renderer a measurement
 * of React instead.
 */
export interface FrameStats {
  /** Instances actually submitted. */
  instances: number
  /** Instances skipped because they fall outside the view. */
  culled: number
  /** Time spent rebuilding the instance buffer, which is zero on most frames. */
  syncMs: number
  /** Time spent in the render call, CPU side. */
  frameMs: number
  /** Wall clock between the last two frames, so it only means anything while interacting. */
  intervalMs: number
}

export const frameStats: FrameStats = {
  instances: 0,
  culled: 0,
  syncMs: 0,
  frameMs: 0,
  intervalMs: 0,
}

export function showStatsFromLocation(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.has('perf') || params.has('stress')
}
