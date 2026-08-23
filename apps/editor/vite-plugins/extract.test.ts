import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { extractComponents, humanise, type ComponentMeta, type PropMeta } from './extract.js'

/**
 * The extractor is what makes the properties panel a view of the code rather than a copy of
 * it, so what these pin is the reading: given this source, these controls. They run against
 * files written to disk, because a type checker resolves imports and a fixture held in a
 * string cannot have a sibling file to import from.
 */

const roots: string[] = []

function project(files: Record<string, string>): ComponentMeta[] {
  const dir = mkdtempSync(join(tmpdir(), 'extract-'))
  roots.push(dir)
  const written: string[] = []
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name)
    writeFileSync(path, source)
    written.push(path)
  }
  return extractComponents(
    written.filter((path) => path.endsWith('.tsx')),
    { importPathFor: (file) => `library/${basename(file).replace(/\.tsx$/, '')}` },
  )
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

const propOf = (meta: ComponentMeta | undefined, key: string): PropMeta | undefined =>
  meta?.props.find((prop) => prop.key === key)

describe('reading a component off its source', () => {
  const [meta] = project({
    'Button.tsx': `
      export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

      export interface ButtonProps {
        label?: string
        variant?: ButtonVariant
        count?: number
        disabled?: boolean
        onPress?: () => void
      }

      export function Button({ label = 'Button', variant = 'primary', count = 3, disabled = false }: ButtonProps) {
        return <button>{label}</button>
      }
    `,
  })

  it('finds the exported component and names it', () => {
    expect(meta?.name).toBe('Button')
    expect(meta?.key).toBe('button')
    expect(meta?.importPath).toBe('library/Button')
  })

  it('reads a string prop as a text field', () => {
    expect(propOf(meta, 'label')?.kind).toBe('text')
  })

  it('reads a union of string literals as a dropdown, in the order it is written', () => {
    const variant = propOf(meta, 'variant')
    expect(variant?.kind).toBe('select')
    expect(variant?.options).toEqual(['primary', 'secondary', 'ghost'])
  })

  it('resolves a type alias rather than giving up on the name', () => {
    // The whole reason this uses a checker: `variant?: ButtonVariant` says nothing on its own.
    expect(propOf(meta, 'variant')?.options).toHaveLength(3)
  })

  it('reads booleans and numbers as their own controls', () => {
    expect(propOf(meta, 'disabled')?.kind).toBe('boolean')
    expect(propOf(meta, 'count')?.kind).toBe('number')
  })

  it('takes defaults from the destructuring, which is where the component states them', () => {
    expect(propOf(meta, 'label')?.default).toBe('Button')
    expect(propOf(meta, 'variant')?.default).toBe('primary')
    expect(propOf(meta, 'count')?.default).toBe(3)
    expect(propOf(meta, 'disabled')?.default).toBe(false)
  })

  /*
   * The document stores scalars, so a control for a callback would be offering to write a
   * value that could not be saved, loaded or undone. The prop is real and the component keeps
   * whatever it does with it; the panel simply has nothing to say about it.
   */
  it('drops a prop it could not store, rather than inventing a control for it', () => {
    expect(propOf(meta, 'onPress')).toBeUndefined()
  })
})

describe('props declared somewhere else', () => {
  it('resolves a props type imported from a sibling file', () => {
    const [meta] = project({
      'types.ts': `
        export interface CardProps {
          title?: string
          tone?: 'quiet' | 'loud'
        }
      `,
      'Card.tsx': `
        import type { CardProps } from './types'
        export function Card({ title = 'Card', tone = 'quiet' }: CardProps) {
          return <section>{title}</section>
        }
      `,
    })
    expect(propOf(meta, 'title')?.kind).toBe('text')
    expect(propOf(meta, 'tone')?.options).toEqual(['quiet', 'loud'])
    expect(propOf(meta, 'title')?.default).toBe('Card')
  })

  it('reads an inline props type, which needs no resolution at all', () => {
    const [meta] = project({
      'Badge.tsx': `
        export function Badge({ text = 'New' }: { text?: string }) {
          return <span>{text}</span>
        }
      `,
    })
    expect(propOf(meta, 'text')?.kind).toBe('text')
  })
})

describe('what counts as a component', () => {
  const found = project({
    'Mixed.tsx': `
      export function Widget({ label = 'a' }: { label?: string }) {
        return <div>{label}</div>
      }
      export function formatLabel(value: string) {
        return value.trim()
      }
      function Hidden({ label = 'b' }: { label?: string }) {
        return <div>{label}</div>
      }
    `,
  })

  it('takes the exported PascalCase function', () => {
    expect(found.map((meta) => meta.name)).toContain('Widget')
  })

  it('leaves an exported helper alone', () => {
    expect(found.map((meta) => meta.name)).not.toContain('formatLabel')
  })

  it('leaves an unexported component alone, since nothing could import it', () => {
    expect(found.map((meta) => meta.name)).not.toContain('Hidden')
  })

  it('finds every component in a file that holds more than one', () => {
    const many = project({
      'Pair.tsx': `
        export function First({ a = '1' }: { a?: string }) { return <i>{a}</i> }
        export function Second({ b = '2' }: { b?: string }) { return <i>{b}</i> }
      `,
    })
    expect(many.map((meta) => meta.name)).toEqual(['First', 'Second'])
  })
})

describe('canvas defaults declared in the component file', () => {
  it('reads a declared width, since being laid out by width is a fact about the component', () => {
    const [meta] = project({
      'Field.tsx': `
        export const canvasDefaults = { width: 220 }
        export function Field({ label = 'Label' }: { label?: string }) {
          return <label>{label}</label>
        }
      `,
    })
    expect(meta?.defaultWidth).toBe(220)
  })

  it('leaves it absent when the file says nothing, which means measure both axes', () => {
    const [meta] = project({
      'Chip.tsx': `
        export function Chip({ label = 'Chip' }: { label?: string }) {
          return <span>{label}</span>
        }
      `,
    })
    expect(meta?.defaultWidth).toBeUndefined()
  })
})

describe('humanise', () => {
  it('splits camel case into a sentence', () => {
    expect(humanise('label')).toBe('Label')
    expect(humanise('defaultOpen')).toBe('Default open')
    expect(humanise('isDisabled')).toBe('Is disabled')
  })

  it('keeps an acronym together', () => {
    expect(humanise('ariaLabel')).toBe('Aria label')
    expect(humanise('showURLBar')).toBe('Show url bar')
  })
})
