import {
  canHaveChildren,
  instantiateSubtree,
  parseSubtree,
  serializeSubtree,
  type NodeId,
  type SceneDocument,
  type SerializedSubtree,
} from '@canvas/document'
import { relayout } from '../state/autoLayout'
import { rerunCodeNodesIn } from '../state/code'
import { duplicateNodes } from '../state/duplicate'
import { isEditingText } from './isEditingText'

export interface ClipboardInputOptions {
  document: SceneDocument
  getSelection: () => readonly NodeId[]
  setSelection: (ids: readonly NodeId[]) => void
}

/** Far enough to see that something happened, near enough to stay obviously related. */
const PASTE_OFFSET = { x: 10, y: 10 }

/**
 * Copy, cut, paste and duplicate.
 *
 * Uses the real clipboard events rather than the async clipboard API, so the data rides on
 * the system clipboard (paste works between two tabs of the editor) without asking for a
 * permission or needing a user gesture to read.
 */
export function createClipboardInput(options: ClipboardInputOptions): () => void {
  const { document: scene } = options

  /**
   * Where a paste lands. A selected frame receives it, any other selected node makes the
   * paste its sibling, and with nothing selected it goes on the page.
   */
  const destination = (): NodeId => {
    const selection = options.getSelection()
    const first = selection.length === 1 ? scene.getNode(selection[0] ?? ('' as NodeId)) : undefined
    if (first) {
      if (canHaveChildren(first)) return first.id
      if (first.parent) return first.parent
    }
    return scene.rootId
  }

  const copySelection = (event: ClipboardEvent): SerializedSubtree | null => {
    const selection = options.getSelection()
    if (selection.length === 0) return null
    const subtree = serializeSubtree(scene, selection)
    if (subtree.nodes.length === 0) return null
    event.clipboardData?.setData('text/plain', JSON.stringify(subtree))
    return subtree
  }

  const onCopy = (event: ClipboardEvent): void => {
    if (isEditingText(event.target)) return
    if (!copySelection(event)) return
    event.preventDefault()
  }

  const onCut = (event: ClipboardEvent): void => {
    if (isEditingText(event.target)) return
    const subtree = copySelection(event)
    if (!subtree) return
    event.preventDefault()
    // Parents noted before the removal, because afterwards the nodes cannot say who held them.
    const parents = subtree.roots
      .map((id) => scene.getNode(id)?.parent)
      .filter((id): id is NodeId => id != null)
    // One transaction, so the removal and the cleared selection are a single undo step.
    scene.transact(() => {
      for (const id of subtree.roots) scene.remove(id)
      relayout(scene, parents)
      options.setSelection([])
    })
  }

  const onPaste = (event: ClipboardEvent): void => {
    if (isEditingText(event.target)) return
    const text = event.clipboardData?.getData('text/plain')
    if (!text) return

    let subtree: SerializedSubtree
    try {
      subtree = parseSubtree(JSON.parse(text) as unknown)
    } catch {
      // Someone pasted text from somewhere else. Not an error, just not for us.
      return
    }

    event.preventDefault()
    const created = scene.transact(() => {
      const pasted = instantiateSubtree(scene, subtree, destination(), PASTE_OFFSET)
      relayout(scene, pasted.map((node) => node.id))
      options.setSelection(pasted.map((node) => node.id))
      return pasted
    })
    rerunCodeNodesIn(created.map((node) => node.id))
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditingText(event.target)) return
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'd') return

    event.preventDefault()
    if (event.repeat) return

    const selection = options.getSelection()
    if (selection.length === 0) return
    // Duplicating reads the current selection rather than the clipboard, so it does not
    // matter what was copied earlier, and it does not overwrite it either.
    const created = duplicateNodes(scene, selection, PASTE_OFFSET)
    rerunCodeNodesIn(created.map((node) => node.id))
    if (created.length > 0) options.setSelection(created.map((node) => node.id))
  }

  window.addEventListener('copy', onCopy)
  window.addEventListener('cut', onCut)
  window.addEventListener('paste', onPaste)
  window.addEventListener('keydown', onKeyDown)

  return () => {
    window.removeEventListener('copy', onCopy)
    window.removeEventListener('cut', onCut)
    window.removeEventListener('paste', onPaste)
    window.removeEventListener('keydown', onKeyDown)
  }
}
