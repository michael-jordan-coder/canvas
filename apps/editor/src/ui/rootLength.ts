/**
 * A length written to a root custom property, which is how every resizable piece of chrome
 * here reports its size.
 *
 * The value goes on a token rather than on a style prop, the same shape the scrub cursor
 * takes: the stylesheet stays the only place a component's CSS is written, and the app grid
 * reads the token without knowing the panel resizes at all. It also has to be the root
 * rather than the element for the floating card, which unmounts when the panel closes and
 * would lose a property set on itself.
 *
 * Shared because both resizers write one, and null meaning "back to the stylesheet's own
 * value" is the kind of convention that gets remembered in one copy and forgotten in the
 * other.
 */
export function setRootLength(cssVar: string, px: number | null): void {
  if (px === null) {
    document.documentElement.style.removeProperty(cssVar)
  } else {
    document.documentElement.style.setProperty(cssVar, `${px}px`)
  }
}
