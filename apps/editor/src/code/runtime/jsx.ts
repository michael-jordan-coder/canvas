/**
 * The jsx factory user code compiles against. `<Frame gap={8}>` becomes
 * `__jsx(Frame, { gap: 8 })` under sucrase's classic pragma, and what comes out is a plain
 * object, not a React element: there is no React here at all. The factory is the whole
 * runtime contract, which is why its shape is the one thing the compiler wrapper injects.
 */

/** What a component function returns. Arrays and primitives flatten during render. */
export type VChild = VElement | string | number | boolean | null | undefined | VChild[]

export type ComponentFn = (props: Record<string, unknown>) => VChild

/** A sentinel rather than a string, so user code cannot collide with it by accident. */
export const __fragment: unique symbol = Symbol('fragment')

export interface VElement {
  readonly kind: 'element'
  readonly type: string | ComponentFn | typeof __fragment
  readonly key: string | undefined
  readonly props: Record<string, unknown>
  readonly children: VChild[]
}

/** The primitives, as string constants so `<Frame>` needs no import resolution to mean it. */
export const Frame = 'frame'
export const Rectangle = 'rectangle'
export const Ellipse = 'ellipse'
export const Text = 'text'

export function __jsx(
  type: string | ComponentFn | typeof __fragment,
  props: Record<string, unknown> | null,
  ...children: VChild[]
): VElement {
  const { key, ...rest } = props ?? {}
  return {
    kind: 'element',
    type,
    key: key === undefined || key === null ? undefined : String(key),
    props: rest,
    children,
  }
}
