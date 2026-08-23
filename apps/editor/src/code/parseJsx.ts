import type { ComponentPropValue } from '@figma-canvas/document'
import type { PropMeta } from '../components/libraryTypes'
import type { PrintableSpec } from './printJsx'

/**
 * Reading a call site back, which is the other half of printing one.
 *
 * The input is one self closing tag holding scalar attributes, because that is exactly what
 * the printer emits and exactly what the document can hold. So this is a small hand written
 * reader rather than a parser: the browser bundle has no TypeScript in it and should not gain
 * one to read `<Button label="Save" />`.
 *
 * Two rules run through all of it, and both are about not half applying an edit:
 *
 * - **It never throws.** Every failure is a message naming what is wrong, in the style
 *   `serialize.ts` sets for the other place untrusted text enters this app.
 * - **It never returns partial props.** A tag with four good attributes and one bad one is an
 *   error, not four props. Writing the good ones would silently drop the one that was
 *   probably being edited.
 *
 * Nothing is coerced. `count="3"` is an error rather than the number three, because the
 * component's type says what it takes and the whole point of this panel is that the type is
 * the thing being respected.
 */

export type ParseResult =
  | { ok: true; props: Record<string, ComponentPropValue> }
  | { ok: false; error: string }

const NAME_START = /[A-Za-z_$]/
const NAME_PART = /[A-Za-z0-9_$]/

function fail(error: string): ParseResult {
  return { ok: false, error }
}

/** What a JSX attribute value can be here, or null if it is not one of them. */
type Value = ComponentPropValue

interface Reader {
  text: string
  at: number
}

function skipSpace(reader: Reader): void {
  while (reader.at < reader.text.length && /\s/.test(reader.text[reader.at] ?? '')) reader.at += 1
}

function readName(reader: Reader): string | null {
  const first = reader.text[reader.at]
  if (first === undefined || !NAME_START.test(first)) return null
  const start = reader.at
  while (reader.at < reader.text.length && NAME_PART.test(reader.text[reader.at] ?? '')) {
    reader.at += 1
  }
  return reader.text.slice(start, reader.at)
}

/**
 * A quoted attribute value.
 *
 * JSX string attributes carry no backslash escapes, so this reads to the closing quote and no
 * further. A string that needs a quote of its own is printed as an expression instead, which
 * is the branch below.
 */
function readQuoted(reader: Reader, quote: string): string | null {
  reader.at += 1
  const start = reader.at
  while (reader.at < reader.text.length && reader.text[reader.at] !== quote) reader.at += 1
  if (reader.at >= reader.text.length) return null
  const value = reader.text.slice(start, reader.at)
  reader.at += 1
  return value
}

/**
 * The inside of `{ ... }`.
 *
 * Braces cannot nest here, since every value is a scalar, but a string can contain one, so the
 * scan tracks whether it is inside a JSON string and skips whatever follows a backslash.
 */
function readBraced(reader: Reader): string | null {
  reader.at += 1
  const start = reader.at
  let inString = false
  while (reader.at < reader.text.length) {
    const character = reader.text[reader.at]
    if (inString) {
      if (character === '\\') reader.at += 2
      else {
        if (character === '"') inString = false
        reader.at += 1
      }
      continue
    }
    if (character === '"') inString = true
    else if (character === '}') {
      const value = reader.text.slice(start, reader.at)
      reader.at += 1
      return value
    }
    reader.at += 1
  }
  return null
}

/** A scalar expression, which is what the printer emits and the only thing the document holds. */
function evaluateExpression(source: string): { value: Value } | null {
  const text = source.trim()
  if (text === 'true') return { value: true }
  if (text === 'false') return { value: false }
  if (text.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text)
      return typeof parsed === 'string' ? { value: parsed } : null
    } catch {
      return null
    }
  }
  // Deliberately not `Number(text)`, which reads '' as 0 and ' 12 ' as 12.
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? { value } : null
}

function describe(meta: PropMeta): string {
  switch (meta.kind) {
    case 'text':
      return `${meta.key} takes a string, as ${meta.key}="text".`
    case 'number':
      return `${meta.key} takes a number, as ${meta.key}={3}.`
    case 'boolean':
      return `${meta.key} takes true or false, as ${meta.key} or ${meta.key}={false}.`
    case 'select':
      return `${meta.key} is one of ${(meta.options ?? []).join(', ')}.`
  }
}

/** A value against what the component says it takes. The type is the authority, not the text. */
function check(meta: PropMeta, value: Value): string | null {
  switch (meta.kind) {
    case 'text':
      return typeof value === 'string' ? null : describe(meta)
    case 'number':
      return typeof value === 'number' ? null : describe(meta)
    case 'boolean':
      return typeof value === 'boolean' ? null : describe(meta)
    case 'select':
      if (typeof value !== 'string') return describe(meta)
      return (meta.options ?? []).includes(value) ? null : describe(meta)
  }
}

/**
 * One call site, as props, or the reason it is not one.
 *
 * The props returned are only what the tag actually names. A prop the tag leaves out is left
 * out, which is what makes this the inverse of a printer that omits defaults: the call site is
 * the record of what was chosen, and everything else is the component's own business.
 */
export function parseInstance(source: string, spec: PrintableSpec): ParseResult {
  const reader: Reader = { text: source.trim(), at: 0 }
  if (reader.text[0] !== '<') return fail(`It has to start with <${spec.name}.`)
  reader.at = 1

  skipSpace(reader)
  const name = readName(reader)
  if (name === null) return fail(`It has to start with <${spec.name}.`)
  if (name !== spec.name) return fail(`This is <${name} />, and the selected component is ${spec.name}.`)

  const byKey = new Map(spec.props.map((prop) => [prop.key, prop]))
  const props: Record<string, ComponentPropValue> = {}

  for (;;) {
    skipSpace(reader)
    if (reader.text.startsWith('/>', reader.at)) {
      reader.at += 2
      break
    }
    if (reader.at >= reader.text.length) return fail('It has to end with />.')
    // A closing tag would mean children, which a component node has no way to hold.
    if (reader.text[reader.at] === '>') return fail(`Write it as one tag, ending with />.`)

    const key = readName(reader)
    if (key === null) return fail(`Expected an attribute name, or />.`)
    if (key in props) return fail(`${key} is set twice.`)

    const meta = byKey.get(key)
    if (!meta) return fail(`${spec.name} has no prop called ${key}.`)

    skipSpace(reader)
    let value: Value
    if (reader.text[reader.at] === '=') {
      reader.at += 1
      skipSpace(reader)
      const character = reader.text[reader.at]
      if (character === '"' || character === "'") {
        const quoted = readQuoted(reader, character)
        if (quoted === null) return fail(`${key} has a quote that is never closed.`)
        value = quoted
      } else if (character === '{') {
        const braced = readBraced(reader)
        if (braced === null) return fail(`${key} has a brace that is never closed.`)
        const evaluated = evaluateExpression(braced)
        // Anything that is not a scalar: a variable, a call, an object, an element. All of
        // them are real JSX and none of them is something the document could store.
        if (!evaluated) return fail(`${describe(meta)} This panel can only hold plain values.`)
        value = evaluated.value
      } else {
        return fail(`${key} needs a value, as ${key}="text" or ${key}={3}.`)
      }
    } else {
      // `disabled` on its own, which is how anyone writes a boolean that is on.
      value = true
    }

    const problem = check(meta, value)
    if (problem) return fail(problem)
    props[key] = value
  }

  skipSpace(reader)
  if (reader.at !== reader.text.length) return fail('There is something after the tag.')
  return { ok: true, props }
}
