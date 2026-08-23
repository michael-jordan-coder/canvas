import { describe, expect, it } from 'vitest'
import type { ComponentPropValue } from '@figma-canvas/document'
import { parseInstance } from './parseJsx'
import { printInstance, type PrintableSpec } from './printJsx'

const SPEC: PrintableSpec = {
  name: 'Button',
  props: [
    { key: 'label', label: 'Label', kind: 'text', default: 'Button', optional: true },
    {
      key: 'variant',
      label: 'Variant',
      kind: 'select',
      options: ['primary', 'secondary', 'ghost'],
      default: 'primary',
      optional: true,
    },
    { key: 'count', label: 'Count', kind: 'number', default: 0, optional: true },
    { key: 'disabled', label: 'Disabled', kind: 'boolean', default: false, optional: true },
    { key: 'collapsible', label: 'Collapsible', kind: 'boolean', default: true, optional: true },
  ],
}

function props(source: string): Record<string, ComponentPropValue> {
  const result = parseInstance(source, SPEC)
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`)
  return result.props
}

function error(source: string): string {
  const result = parseInstance(source, SPEC)
  if (result.ok) throw new Error(`expected an error, got: ${JSON.stringify(result.props)}`)
  return result.error
}

describe('reading a call site', () => {
  it('reads a tag with nothing on it', () => {
    expect(props('<Button />')).toEqual({})
  })

  it('reads every kind of value', () => {
    expect(props('<Button label="Save" variant="ghost" count={3} disabled={false} />')).toEqual({
      label: 'Save',
      variant: 'ghost',
      count: 3,
      disabled: false,
    })
  })

  it('reads a bare boolean as true, which is how anyone writes one', () => {
    expect(props('<Button disabled />')).toEqual({ disabled: true })
  })

  it('reads a string carrying a quote, which the printer writes as an expression', () => {
    expect(props('<Button label={"He said \\"go\\""} />')).toEqual({ label: 'He said "go"' })
  })

  it('reads a negative and a fractional number', () => {
    expect(props('<Button count={-2.5} />')).toEqual({ count: -2.5 })
  })

  it('reads single quotes, which are not what it prints but are what people type', () => {
    expect(props("<Button label='Save' />")).toEqual({ label: 'Save' })
  })

  it('reads a tag written over several lines', () => {
    expect(props('<Button\n  label="Save"\n  disabled\n/>')).toEqual({
      label: 'Save',
      disabled: true,
    })
  })

  it('reads spaces around the equals, which JSX allows', () => {
    expect(props('<Button label = "Save" />')).toEqual({ label: 'Save' })
  })

  /*
   * The one that makes this the inverse of a printer which omits defaults. What is not named
   * is not returned, so committing a call site is what makes the tag the record of what was
   * chosen rather than a restatement of the component's signature.
   */
  it('returns only what the tag names', () => {
    expect(props('<Button label="Save" />')).toEqual({ label: 'Save' })
  })
})

describe('what a call site cannot say', () => {
  it('refuses a prop the component does not have', () => {
    expect(error('<Button colour="red" />')).toBe('Button has no prop called colour.')
  })

  it('refuses the wrong component', () => {
    expect(error('<Card label="Save" />')).toContain('the selected component is Button')
  })

  it('refuses a value outside a union, which is the whole point of a closed set', () => {
    expect(error('<Button variant="plaid" />')).toBe('variant is one of primary, secondary, ghost.')
  })

  // Nothing is coerced. The component's type says what it takes.
  it('refuses a number written as a string, and a string written as a number', () => {
    expect(error('<Button count="3" />')).toContain('count takes a number')
    expect(error('<Button label={3} />')).toContain('label takes a string')
  })

  it('refuses an expression that is not a plain value', () => {
    expect(error('<Button label={title} />')).toContain('plain values')
    expect(error('<Button label={`x`} />')).toContain('plain values')
    expect(error('<Button count={1 + 1} />')).toContain('plain values')
  })

  it('refuses a value that is not finite, which JSX cannot carry back', () => {
    expect(error('<Button count={1e999} />')).toContain('plain values')
  })

  it('refuses the same attribute twice', () => {
    expect(error('<Button label="a" label="b" />')).toBe('label is set twice.')
  })

  it('refuses a tag that is never closed', () => {
    expect(error('<Button label="Save"')).toBe('It has to end with />.')
    expect(error('<Button label="Save />')).toContain('never closed')
  })

  it('refuses children, which a component node has no way to hold', () => {
    expect(error('<Button>Save</Button>')).toContain('one tag')
  })

  it('refuses anything after the tag', () => {
    expect(error('<Button /><Button />')).toBe('There is something after the tag.')
  })

  it('refuses something that is not a tag at all', () => {
    expect(error('Button')).toBe('It has to start with <Button.')
    expect(error('')).toBe('It has to start with <Button.')
  })

  it('returns no props at all when one attribute is bad', () => {
    const result = parseInstance('<Button label="Save" variant="plaid" />', SPEC)
    expect(result.ok).toBe(false)
  })
})

/*
 * The two halves have to agree, and the round trip is the only test that can say so. It is not
 * an identity on props: printing drops a value equal to the component's own default, so what
 * comes back is what was actually chosen. That is the intended meaning of a call site and this
 * pins it rather than working around it.
 */
describe('printing and reading back', () => {
  const cases: Record<string, ComponentPropValue>[] = [
    {},
    { label: 'Save changes' },
    { label: 'Save', variant: 'ghost', count: 3, disabled: true },
    { label: 'He said "go"' },
    { label: 'A label long enough to push this call site past the wrapping width it uses' },
    { count: -2.5 },
    { collapsible: false },
  ]

  for (const [index, value] of cases.entries()) {
    it(`survives case ${index}`, () => {
      const printed = printInstance(SPEC, value)
      expect(parseInstance(printed, SPEC)).toEqual({ ok: true, props: value })
    })
  }

  it('drops what the component already defaults to, on the way through', () => {
    const printed = printInstance(SPEC, { label: 'Button', variant: 'ghost' })
    expect(printed).toBe('<Button variant="ghost" />')
    expect(parseInstance(printed, SPEC)).toEqual({ ok: true, props: { variant: 'ghost' } })
  })
})
