import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import {
  invert,
  transformRect,
  type Mat2D,
  type NodeId,
  type Rect,
  type SceneDocument,
  type SceneNode,
} from '@figma-canvas/document'
import { viewMatrix } from '@figma-canvas/renderer'
import { componentSpec } from '../components/registry'
import { attachComponentShadow } from '../components/shadow'
import { scene } from '../state/scene'
import { useUI } from '../state/uiStore'
import { viewport } from '../state/viewport'
import styles from './ComponentLayer.module.css'

/**
 * The React half of the canvas.
 *
 * Everything the document says is a component node is mounted here, through React DOM, as
 * the actual component: not a picture of one, not a canvas impression of one, and not an
 * approximation in HTML. The GPU draws the workspace, the frames, the shapes, the text and
 * the selection overlay; this layer draws exactly the things React is better at.
 *
 * The two layers stay aligned because they are given the same matrix. `viewMatrix` is what
 * the world to clip matrix is built from, and it is written straight into a CSS transform
 * here, so a pan or a zoom moves both by construction rather than by agreement.
 *
 * The layer sits between two canvases: the document below it and the selection overlay
 * above. That is the whole reason the renderer has two surfaces.
 */
export function ComponentLayer(): ReactElement {
  const mode = useUI((state) => state.mode)
  const groups = useComponentGroups()
  const visible = useVisibleArtboards(groups)
  const world = useRef<HTMLDivElement>(null)

  /*
   * The camera, applied imperatively.
   *
   * A pan is a hundred and twenty of these a second, and every one of them would otherwise be
   * a React render of the whole layer. This writes one custom property on one element, which
   * is a composited transform and nothing else.
   */
  useLayoutEffect(() => {
    const apply = (): void => {
      const element = world.current
      if (!element) return
      const view = viewMatrix(viewport.camera, viewport.size)
      element.style.setProperty('--view-transform', matrix(view))
    }
    apply()
    return viewport.subscribe(apply)
  }, [])

  return (
    <div className={styles.layer} data-mode={mode}>
      <div ref={world} className={styles.world}>
        {groups
          .filter((group) => visible.has(group.hostId))
          .map((group) => (
            <Artboard key={group.hostId} hostId={group.hostId} nodeIds={group.nodeIds} />
          ))}
      </div>
    </div>
  )
}

/** A CSS matrix() from a Mat2D. The two use the same component order, so this is a spelling. */
function matrix(m: Mat2D): string {
  return `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.tx}, ${m.ty})`
}

// Grouping ---------------------------------------------------------------------------------

interface Artboards {
  /** The frame holding these components, or the page for components dropped loose. */
  hostId: NodeId
  /** In document order, which is paint order, which is also DOM order here. */
  nodeIds: NodeId[]
}

/**
 * The component nodes, grouped by the node that holds them.
 *
 * Only a page or a frame can hold children, so a component's holder is its parent and
 * nothing has to search upward for one. Each group becomes one positioned element with one
 * transform, which is what keeps a frame full of components at one transform update per pan
 * rather than one per component.
 */
function componentGroups(document: SceneDocument): Artboards[] {
  const groups = new Map<NodeId, NodeId[]>()
  for (const node of document.walk()) {
    if (node.type !== 'component') continue
    const hostId = node.parent ?? document.rootId
    const existing = groups.get(hostId)
    if (existing) existing.push(node.id)
    else groups.set(hostId, [node.id])
  }
  return [...groups].map(([hostId, nodeIds]) => ({ hostId, nodeIds }))
}

function sameGroups(a: readonly Artboards[], b: readonly Artboards[]): boolean {
  if (a.length !== b.length) return false
  return a.every((group, index) => {
    const other = b[index]
    if (!other || other.hostId !== group.hostId) return false
    if (other.nodeIds.length !== group.nodeIds.length) return false
    return group.nodeIds.every((id, at) => other.nodeIds[at] === id)
  })
}

/**
 * Structural changes only.
 *
 * Moving a component does not change which artboard holds it or in what order, so a drag
 * must not rebuild this list: the mount that is moving re-renders itself and nothing else
 * does. Reparenting one does, and that is exactly a structural change.
 */
function useComponentGroups(): Artboards[] {
  const [groups, setGroups] = useState<Artboards[]>(() => componentGroups(scene))

  useEffect(() => {
    const update = (): void => {
      setGroups((previous) => {
        const next = componentGroups(scene)
        // Same list means the same array, so nothing below re-renders and no mount is torn
        // down and rebuilt, which would throw away the component's React state.
        return sameGroups(previous, next) ? previous : next
      })
    }
    // Once on mount as well: a structural change between the first render and this
    // subscription would otherwise be missed for good.
    update()
    return scene.subscribe((change) => {
      if (change.structural) update()
    })
  }, [])

  return groups
}

// Virtualization ----------------------------------------------------------------------------

/**
 * How far past the viewport an artboard is still mounted, as a fraction of the viewport.
 *
 * The same idea as the instance buffer's `CULL_MARGIN` and for the same reason: an artboard
 * that unmounts the instant its edge leaves the screen would rebuild its whole React tree,
 * and lose everything typed into it, on a pan that barely moved.
 */
const MOUNT_MARGIN = 0.5

function expand(rect: Rect, fraction: number): Rect {
  const x = rect.width * fraction
  const y = rect.height * fraction
  return { x: rect.x - x, y: rect.y - y, width: rect.width + x * 2, height: rect.height + y * 2 }
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** The union of a group's component bounds in world space, or null if it has none on screen. */
function groupBounds(document: SceneDocument, group: Artboards): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of group.nodeIds) {
    const node = document.getNode(id)
    if (!node) continue
    const box = transformRect(document.worldTransform(id), { x: 0, y: 0, ...node.size })
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function visibleArtboards(groups: readonly Artboards[]): Set<NodeId> {
  const view = transformRect(invert(viewMatrix(viewport.camera, viewport.size)), {
    x: 0,
    y: 0,
    width: viewport.size.width,
    height: viewport.size.height,
  })
  const region = expand(view, MOUNT_MARGIN)
  const found = new Set<NodeId>()
  for (const group of groups) {
    const bounds = groupBounds(scene, group)
    if (bounds && intersects(region, bounds)) found.add(group.hostId)
  }
  return found
}

function sameSet(a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/**
 * Which artboards are close enough to the viewport to be worth mounting.
 *
 * Unmounting is the point: a React tree for an artboard nobody is looking at costs layout,
 * style and memory for nothing, and a document can have a great many artboards. What it
 * costs is the state inside those components, which is why the margin is generous and why
 * the set is only ever replaced when it actually differs.
 */
function useVisibleArtboards(groups: readonly Artboards[]): ReadonlySet<NodeId> {
  const [visible, setVisible] = useState<ReadonlySet<NodeId>>(() => visibleArtboards(groups))

  useEffect(() => {
    const update = (): void => {
      setVisible((previous) => {
        const next = visibleArtboards(groups)
        return sameSet(previous, next) ? previous : next
      })
    }
    update()
    const stopWatchingCamera = viewport.subscribe(update)
    // A component dragged out of view should eventually unmount too, and a document change
    // is the only notice of that. The comparison above is what keeps this free: a drag
    // inside the viewport computes a set, finds it identical and re-renders nothing.
    const stopWatchingScene = scene.subscribe(update)
    return () => {
      stopWatchingCamera()
      stopWatchingScene()
    }
  }, [groups])

  return visible
}

// Ancestry ----------------------------------------------------------------------------------

/**
 * Re-renders when a node or any of its ancestors changes.
 *
 * `useNode` is not enough here, because where a mount is drawn and whether it is drawn at
 * all are inherited: a frame moving moves everything in it, and a frame being hidden hides
 * everything in it. The walk is one step per level of nesting per notification, against a
 * chain that is two or three deep in practice.
 */
function useAncestry(id: NodeId | undefined): void {
  // A revision rather than the node itself, exactly as `useNode` keeps one: the snapshot has
  // to be a value React can compare, and the document is mutable, so the node object is the
  // same object before and after the change that matters.
  const revision = useRef(0)

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!id) return () => {}
      return scene.subscribe((change) => {
        let node: SceneNode | undefined = scene.getNode(id)
        while (node) {
          if (change.changed.has(node.id)) {
            revision.current += 1
            onChange()
            return
          }
          node = node.parent ? scene.getNode(node.parent) : undefined
        }
      })
    },
    [id],
  )

  useSyncExternalStore(subscribe, () => revision.current)
}

/** Whether every node from here to the root is visible, which is what the renderer asks too. */
function inheritedVisible(id: NodeId): boolean {
  let node: SceneNode | undefined = scene.getNode(id)
  while (node) {
    if (!node.visible) return false
    node = node.parent ? scene.getNode(node.parent) : undefined
  }
  return true
}

/** Opacity multiplies down the tree, the same way it does when the packer walks it. */
function inheritedOpacity(id: NodeId): number {
  let alpha = 1
  let node: SceneNode | undefined = scene.getNode(id)
  while (node) {
    alpha *= node.opacity
    node = node.parent ? scene.getNode(node.parent) : undefined
  }
  return alpha
}

// The mounts ---------------------------------------------------------------------------------

function Artboard({
  hostId,
  nodeIds,
}: {
  hostId: NodeId
  nodeIds: readonly NodeId[]
}): ReactElement | null {
  useAncestry(hostId)
  const element = useRef<HTMLDivElement>(null)
  const host = scene.getNode(hostId)
  const clips = host?.type === 'frame' && host.clipsContent

  useLayoutEffect(() => {
    const node = element.current
    if (!node || !host) return
    node.style.setProperty('--artboard-transform', matrix(scene.worldTransform(hostId)))
    // The page has no extent of its own, so it clips nothing and sizes to nothing: its
    // components are placed by their own transforms and hang off it freely.
    node.style.setProperty('--artboard-width', host.type === 'page' ? '0' : `${host.size.width}px`)
    node.style.setProperty(
      '--artboard-height',
      host.type === 'page' ? '0' : `${host.size.height}px`,
    )
  })

  if (!host) return null

  return (
    <div ref={element} className={styles.artboard} data-clip={clips}>
      {nodeIds.map((id) => (
        <ComponentMount key={id} id={id} />
      ))}
    </div>
  )
}

/**
 * One component node, mounted through React DOM into its own shadow root.
 *
 * The element is created once and never replaced, so panning, zooming, selecting, moving and
 * editing the props all leave the component's own state exactly where it was. Only the
 * document removing the node, or the artboard leaving the viewport, unmounts it.
 */
function ComponentMount({ id }: { id: NodeId }): ReactElement | null {
  useAncestry(id)
  const host = useRef<HTMLDivElement>(null)
  // The element inside the shadow root React portals into. Null for exactly one render,
  // since a shadow root cannot be attached until the host element exists.
  const [mount, setMount] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (host.current) setMount(attachComponentShadow(host.current))
  }, [])

  const node = scene.getNode(id)

  useLayoutEffect(() => {
    const element = host.current
    if (!element || node?.type !== 'component') return
    element.style.setProperty('--mount-transform', matrix(node.transform))
    element.style.setProperty('--mount-width', `${node.size.width}px`)
    element.style.setProperty('--mount-height', `${node.size.height}px`)
    element.style.setProperty('--mount-opacity', String(inheritedOpacity(id)))
  })

  if (node?.type !== 'component') return null
  // Hidden by itself or by anything above it, exactly as the packer would skip it.
  if (!inheritedVisible(id)) return null

  const spec = componentSpec(node.component)

  return (
    <div ref={host} className={styles.mount} data-component={node.component}>
      {mount &&
        createPortal(
          spec ? (
            spec.render(node.props)
          ) : (
            // A saved file naming a component this build no longer ships. Showing where it
            // was beats dropping it, which would silently edit someone's document on load.
            <div className="missing">Unknown component &ldquo;{node.component}&rdquo;</div>
          ),
          mount,
        )}
    </div>
  )
}
