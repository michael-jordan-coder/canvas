import type { ReactElement } from 'react'
import type { ComponentPropValue, Size } from '@figma-canvas/document'
import { Button, type ButtonSize, type ButtonVariant } from './library/Button'
import { Card } from './library/Card'
import { Input } from './library/Input'

/**
 * The registry: the one place that knows a component node's `component` key names a real
 * React component, what it can be told, and how to render it.
 *
 * It lives in the app rather than in `packages/document` for the same reason the font does:
 * the scene model has no DOM and no React and must not gain either. The document stores a
 * key and a bag of scalars, and everything that turns those into an element happens here.
 *
 * `importPath` and `exportName` are not used at runtime. They are the two things a code
 * generator needs and the two things nothing else in the app can recover, so they are
 * recorded at the point the component is registered rather than reconstructed later from a
 * file layout that will have moved by then.
 */

export type PropKind = 'text' | 'number' | 'boolean' | 'select'

export interface PropSpec {
  key: string
  label: string
  kind: PropKind
  /** What a freshly dropped instance is created with, and what the panel resets to. */
  default: ComponentPropValue
  /** `select` only. The panel offers exactly these, so a typo cannot reach the component. */
  options?: readonly string[]
}

export interface ComponentSpec {
  /** Stored in the document. Renaming one orphans every saved instance, so treat it as an id. */
  key: string
  name: string
  /** Where a generated file would import this from, relative to the app's `src`. */
  importPath: string
  exportName: string
  props: readonly PropSpec[]
  /**
   * The preview renderer.
   *
   * Written as an adapter per component rather than as `ComponentType<Props>`, because this
   * is the boundary between the document's scalars and a typed React prop: a saved file can
   * name a variant this build no longer has, and the fallback for that belongs here rather
   * than inside a component that has no reason to expect it.
   */
  render: (props: Record<string, ComponentPropValue>) => ReactElement
  /**
   * The size used when a component cannot be measured, which in practice means before the
   * DOM is available. Everything else measures what the component actually renders.
   */
  fallbackSize: Size
  /**
   * Present when the component is laid out by its width: it fills whatever room it is given
   * and its height follows from that, so it is measured at a width rather than at its
   * natural size. This is the width a freshly dropped instance starts at.
   *
   * Absent when the component's size is entirely its own content, which is a button: asking
   * a button to be 400 wide is a resize, not a measurement.
   */
  defaultWidth?: number
}

// The scalar to prop coercions. One per kind, all total, none of them throwing: a document
// is untrusted input once it has been saved and loaded, and a component is the wrong place
// to find that out.

const text = (value: ComponentPropValue | undefined, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const bool = (value: ComponentPropValue | undefined, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback

function oneOf<T extends string>(
  value: ComponentPropValue | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

const BUTTON_VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']
const BUTTON_SIZES: readonly ButtonSize[] = ['small', 'medium', 'large']

const SPECS: readonly ComponentSpec[] = [
  {
    key: 'button',
    name: 'Button',
    importPath: 'components/library/Button',
    exportName: 'Button',
    fallbackSize: { width: 96, height: 34 },
    props: [
      { key: 'label', label: 'Label', kind: 'text', default: 'Button' },
      {
        key: 'variant',
        label: 'Variant',
        kind: 'select',
        default: 'primary',
        options: BUTTON_VARIANTS,
      },
      { key: 'size', label: 'Size', kind: 'select', default: 'medium', options: BUTTON_SIZES },
      { key: 'disabled', label: 'Disabled', kind: 'boolean', default: false },
    ],
    render: (props) => (
      <Button
        label={text(props['label'], 'Button')}
        variant={oneOf(props['variant'], BUTTON_VARIANTS, 'primary')}
        size={oneOf(props['size'], BUTTON_SIZES, 'medium')}
        disabled={bool(props['disabled'])}
      />
    ),
  },
  {
    key: 'input',
    name: 'Input',
    importPath: 'components/library/Input',
    exportName: 'Input',
    fallbackSize: { width: 220, height: 58 },
    defaultWidth: 220,
    props: [
      { key: 'label', label: 'Label', kind: 'text', default: 'Email' },
      { key: 'placeholder', label: 'Placeholder', kind: 'text', default: 'you@example.com' },
      { key: 'hint', label: 'Hint', kind: 'text', default: '' },
      { key: 'invalid', label: 'Invalid', kind: 'boolean', default: false },
      { key: 'disabled', label: 'Disabled', kind: 'boolean', default: false },
    ],
    render: (props) => (
      <Input
        label={text(props['label'], 'Label')}
        placeholder={text(props['placeholder'])}
        hint={text(props['hint'])}
        invalid={bool(props['invalid'])}
        disabled={bool(props['disabled'])}
      />
    ),
  },
  {
    key: 'card',
    name: 'Card',
    importPath: 'components/library/Card',
    exportName: 'Card',
    fallbackSize: { width: 280, height: 120 },
    defaultWidth: 280,
    props: [
      { key: 'title', label: 'Title', kind: 'text', default: 'Card title' },
      {
        key: 'body',
        label: 'Body',
        kind: 'text',
        default: 'Supporting copy that explains what this card is for.',
      },
      { key: 'elevated', label: 'Elevated', kind: 'boolean', default: false },
      { key: 'collapsible', label: 'Collapsible', kind: 'boolean', default: true },
    ],
    render: (props) => (
      <Card
        title={text(props['title'], 'Card title')}
        body={text(props['body'])}
        elevated={bool(props['elevated'])}
        collapsible={bool(props['collapsible'], true)}
      />
    ),
  },
]

const BY_KEY = new Map(SPECS.map((spec) => [spec.key, spec]))

/** In panel order, which is the order they are declared above. */
export function componentSpecs(): readonly ComponentSpec[] {
  return SPECS
}

/**
 * The spec for a key, or undefined.
 *
 * Undefined is a real answer rather than an error: a saved file can name a component this
 * build no longer ships, and losing the node would be worse than showing a placeholder where
 * it sits. Everything that renders one handles the gap.
 */
export function componentSpec(key: string): ComponentSpec | undefined {
  return BY_KEY.get(key)
}

/** What a freshly dropped instance carries, so every editable prop starts with a value. */
export function defaultProps(spec: ComponentSpec): Record<string, ComponentPropValue> {
  const props: Record<string, ComponentPropValue> = {}
  for (const prop of spec.props) props[prop.key] = prop.default
  return props
}
