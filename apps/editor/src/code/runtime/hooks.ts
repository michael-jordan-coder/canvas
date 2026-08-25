/**
 * React's hooks without React: an index-ordered array of cells per component, filled on
 * first render and read back on every one after. The array lives in the session, outside
 * the render, which is the entire trick; the component function stays pure and the state
 * survives it. Same model, same rule, same reason the rule exists: a hook inside a
 * condition would read someone else's cell.
 */

export interface StateCell {
  kind: 'state'
  value: unknown
}

export interface EffectCell {
  kind: 'effect'
  deps: readonly unknown[] | undefined
  cleanup: (() => void) | null
}

export interface MemoCell {
  kind: 'memo'
  deps: readonly unknown[] | undefined
  value: unknown
}

export interface RefCell {
  kind: 'ref'
  ref: { current: unknown }
}

export type HookCell = StateCell | EffectCell | MemoCell | RefCell

/**
 * An effect the render decided has to run, deferred so the render itself stays pure. The
 * runner executes these after the tree has been posted, mirroring React running effects
 * after commit.
 */
export interface EffectTask {
  run: () => void
}

interface RenderContext {
  cells: HookCell[]
  index: number
  effects: EffectTask[]
  requestRerender: () => void
}

let current: RenderContext | null = null

/** Entered by the renderer around each component call; hooks are illegal anywhere else. */
export function enterComponent(
  cells: HookCell[],
  effects: EffectTask[],
  requestRerender: () => void,
): void {
  current = { cells, index: 0, effects, requestRerender }
}

export function exitComponent(): void {
  current = null
}

function context(): RenderContext {
  if (!current) {
    throw new Error('Hooks can only be called while a component renders.')
  }
  return current
}

/**
 * The cell at the current index, made if this is the first render. A cell whose kind
 * changed means the hook order changed between renders, which is the one thing this model
 * cannot survive; the reset is deliberate and loud rather than a corrupt read.
 */
function takeCell<T extends HookCell>(make: () => T, kind: T['kind']): T {
  const ctx = context()
  const at = ctx.index
  ctx.index += 1
  const existing = ctx.cells[at]
  if (existing && existing.kind === kind) return existing as T
  // The reset drops this cell and everything after it, and an effect cell holds the only
  // reference to its own teardown. Dropping one without running it leaves the interval or
  // the listener it registered alive for the rest of the session, with nothing left that
  // could stop it.
  if (existing) cleanupCells([existing])
  cleanupCells(ctx.cells.slice(ctx.index))
  const cell = make()
  ctx.cells[at] = cell
  ctx.cells.length = ctx.index
  return cell
}

function sameDeps(
  a: readonly unknown[] | undefined,
  b: readonly unknown[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const ctx = context()
  const cell = takeCell<StateCell>(
    () => ({
      kind: 'state',
      value: typeof initial === 'function' ? (initial as () => T)() : initial,
    }),
    'state',
  )
  const set = (next: T | ((prev: T) => T)): void => {
    const value =
      typeof next === 'function' ? (next as (prev: T) => T)(cell.value as T) : next
    if (Object.is(value, cell.value)) return
    cell.value = value
    ctx.requestRerender()
  }
  return [cell.value as T, set]
}

export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
  const ctx = context()
  const cell = takeCell<EffectCell>(
    () => ({ kind: 'effect', deps: undefined, cleanup: null }),
    'effect',
  )
  if (cell.deps !== undefined && sameDeps(cell.deps, deps)) return
  const nextDeps = deps
  ctx.effects.push({
    run: () => {
      cell.cleanup?.()
      const cleanup = effect()
      cell.cleanup = typeof cleanup === 'function' ? cleanup : null
      cell.deps = nextDeps ?? []
    },
  })
}

export function useMemo<T>(compute: () => T, deps?: readonly unknown[]): T {
  const cell = takeCell<MemoCell>(
    () => ({ kind: 'memo', deps: undefined, value: undefined }),
    'memo',
  )
  if (cell.deps === undefined || !sameDeps(cell.deps, deps)) {
    cell.value = compute()
    cell.deps = deps ?? []
  }
  return cell.value as T
}

export function useRef<T>(initial: T): { current: T } {
  const cell = takeCell<RefCell>(() => ({ kind: 'ref', ref: { current: initial } }), 'ref')
  return cell.ref as { current: T }
}

/** Runs every cleanup a component path left behind; called when the path or session dies. */
export function cleanupCells(cells: readonly HookCell[]): void {
  for (const cell of cells) {
    if (cell.kind === 'effect') {
      cell.cleanup?.()
      cell.cleanup = null
    }
  }
}
