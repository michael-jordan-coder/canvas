import { describe, expect, it } from 'vitest'
import type { PropMeta } from '../components/libraryTypes'
import { printInstance, type PrintableSpec } from './printJsx.js'

/**
 * The printer is one half of the code panel's level 1, where the JSX shown is a view of the
 * document rather than of a file. It takes a plain list of prop descriptions rather than a
 * `ComponentSpec`, which is what lets these tests state a component as a literal: importing
 * the registry would drag in the virtual module, the module glob and React, none of which
 * printing a string has any use for.
 */

const prop = (over: Partial<PropMeta> & Pick<PropMeta, 'key' | 'kind'>): PropMeta => ({
  label: over.key,
  optional: true,
  ...over,
})

const button: PrintableSpec = {
  name: 'Button',
  props: [
    prop({ key: 'label', kind: 'text', default: 'Button' }),
    prop({ key: 'variant', kind: 'select', options: ['primary', 'secondary'], default: 'primary' }),
    prop({ key: 'count', kind: 'number', default: 0 }),
    prop({ key: 'disabled', kind: 'boolean', default: false }),
    // A prop the component defaults to true, which is the only case where printing false
    // says something the signature does not. `Card.collapsible` is the real one.
    prop({ key: 'collapsible', kind: 'boolean', default: true }),
  ],
}

describe('printing a component call site', () => {
  it('prints a bare tag when nothing has been set', () => {
    expect(printInstance(button, {})).toBe('<Button />')
  })

  it('prints a string in quotes, the way anyone would write it', () => {
    expect(printInstance(button, { label: 'Save' })).toBe('<Button label="Save" />')
  })

  it('prints a number in braces, because JSX needs an expression for one', () => {
    expect(printInstance(button, { count: 3 })).toBe('<Button count={3} />')
  })

  it('prints a boolean turned on as the shorthand', () => {
    expect(printInstance(button, { disabled: true })).toBe('<Button disabled />')
  })

  /*
   * Two rules meet here, and the order matters. Turning off a prop the component already
   * defaults to off says nothing the signature does not, so it is omitted. Turning off one
   * the component defaults to on is a real choice, and there is no shorthand for it.
   */
  it('spells out a boolean turned off against a default of on', () => {
    expect(printInstance(button, { collapsible: false })).toBe('<Button collapsible={false} />')
    expect(printInstance(button, { disabled: false })).toBe('<Button />')
  })

  /*
   * The signature already states the default, so printing it is noise. A panel that showed
   * every default would bury the one or two attributes that were actually chosen.
   */
  it('leaves out a value equal to the component own default', () => {
    expect(printInstance(button, { label: 'Button', variant: 'primary' })).toBe('<Button />')
  })

  it('keeps a value that only looks like the default', () => {
    expect(printInstance(button, { label: 'Button ' })).toBe('<Button label="Button " />')
  })

  /*
   * A prop bag's key order is whatever the editing session happened to produce, and the same
   * component should not print two different ways depending on which field was touched first.
   */
  it('follows the order the component declares its props, not the order they were set', () => {
    const props = { disabled: true, label: 'Save', count: 2 }
    expect(printInstance(button, props)).toBe('<Button label="Save" count={2} disabled />')
  })

  it('ignores a prop the component does not declare', () => {
    expect(printInstance(button, { label: 'Save', colour: 'red' })).toBe('<Button label="Save" />')
  })

  it('falls back to an expression for a string a quoted attribute cannot carry', () => {
    expect(printInstance(button, { label: 'He said "no"' })).toBe(
      '<Button label={"He said \\"no\\""} />',
    )
    expect(printInstance(button, { label: 'two\nlines' })).toBe('<Button label={"two\\nlines"} />')
  })

  it('drops a number the document should never have held rather than printing NaN', () => {
    expect(printInstance(button, { count: Number.NaN, label: 'x' })).toBe('<Button label="x" />')
  })

  it('goes one attribute to a line once it would be too long to read', () => {
    const printed = printInstance(button, {
      label: 'A label long enough to push this past a comfortable width',
      variant: 'secondary',
    })
    expect(printed).toBe(
      [
        '<Button',
        '  label="A label long enough to push this past a comfortable width"',
        '  variant="secondary"',
        '/>',
      ].join('\n'),
    )
  })

  it('is stable: printing twice gives the same string', () => {
    const props = { label: 'Save', disabled: true }
    expect(printInstance(button, props)).toBe(printInstance(button, props))
  })
})
