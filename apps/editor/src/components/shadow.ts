import libraryCss from './library/library.css?inline'

/**
 * One stylesheet object shared by every shadow root, built once.
 *
 * A `<style>` element per root would mean the browser parsing the same CSS again for every
 * artboard on screen, and a document with a dozen frames would pay for a dozen copies of it.
 * A constructed sheet is parsed once and adopted by reference.
 */
let sheet: CSSStyleSheet | null = null

function libraryStyleSheet(): CSSStyleSheet | null {
  if (sheet) return sheet
  try {
    const created = new CSSStyleSheet()
    created.replaceSync(libraryCss)
    sheet = created
    return sheet
  } catch {
    // Constructed stylesheets are not universally available. The `<style>` fallback below
    // costs a reparse per root and is otherwise identical.
    return null
  }
}

/**
 * Gives `host` a shadow root carrying the component library's styles, and returns the
 * element React should mount into.
 *
 * The shadow root is what makes the mounted components genuinely isolated: the editor's own
 * stylesheet, its resets and its design tokens stop at the boundary, and so does anything
 * the components do to headings, buttons or inputs. Without it a product's real CSS and the
 * design tool's would be one cascade, and whichever loaded last would win.
 *
 * An iframe would isolate more (its own layout viewport, its own event loop) and cost far
 * more: a document, a stylesheet and a React root per artboard, and every pointer coordinate
 * crossing a frame boundary. A shadow root is the amount of isolation this needs.
 */
export function attachComponentShadow(host: HTMLElement): HTMLElement {
  // Idempotent, because StrictMode runs every effect twice and `attachShadow` throws on an
  // element that already hosts one. Returning the existing mount also means a remount reuses
  // the tree that is already there rather than building a second one beside it.
  const existing = host.shadowRoot?.querySelector<HTMLElement>('.root')
  if (existing) return existing

  const root = host.attachShadow({ mode: 'open' })
  const adopted = libraryStyleSheet()
  if (adopted) {
    root.adoptedStyleSheets = [adopted]
  } else {
    const style = window.document.createElement('style')
    style.textContent = libraryCss
    root.append(style)
  }

  const mount = window.document.createElement('div')
  // The class the library sheet hangs its inherited type styles off. Everything a component
  // renders sits under it, so a component never has to state the font it is drawn in.
  mount.className = 'root'
  root.append(mount)
  return mount
}
