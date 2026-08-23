import type { ComponentPropValue } from '@figma-canvas/document'
import type { PropMeta } from '../components/libraryTypes'

/**
 * The call site of a component node, as JSX.
 *
 * This is a view of the document rather than of a file: the node holds a registry key and a bag
 * of scalars, and this is what that would look like written out where a person could read it.
 * The component's own source is a different thing entirely, read off disk, and the code panel
 * keeps the two clearly apart.
 *
 * Printing is deliberately total and boring. It takes only what the component declares, in the
 * order the component declares it, so the output is stable against a prop bag whose insertion
 * order is whatever the editing session happened to produce.
 */

/**
 * Everything printing needs from a component, which is less than a `ComponentSpec` carries.
 *
 * Narrowed so this module stays pure and testable on a literal: importing the registry would
 * drag in `virtual:component-library`, the module glob and React, none of which printing a
 * string has any use for.
 */
export interface PrintableSpec {
  name: string
  props: readonly PropMeta[]
}

/** Past this, the attributes go one to a line, which is what a person would have typed. */
const WRAP_AT = 72
const INDENT = '  '

/**
 * A string as a JSX attribute value.
 *
 * The quoted form is the one people write, so it is preferred, but it cannot carry a double
 * quote or a newline. Those fall back to an expression holding a JSON string, which is valid
 * JSX, survives the round trip, and is rare enough not to be worth prettier handling.
 */
function printString(value: string): string {
  if (value.includes('"') || value.includes('\n')) return `{${JSON.stringify(value)}}`
  return `"${value}"`
}

function printValue(value: ComponentPropValue): string | null {
  switch (typeof value) {
    case 'string':
      return printString(value)
    case 'number':
      // Not a finite number is not something JSX can carry, and the document should not have
      // one. Dropping the attribute leaves the component on its own default.
      return Number.isFinite(value) ? `{${value}}` : null
    case 'boolean':
      // `disabled` rather than `disabled={true}`, which is how anyone would write it. False is
      // spelled out, because the alternative is omitting it, and omitting a prop that was
      // deliberately set to false would read as never having been set.
      return value ? '' : '{false}'
    default:
      return null
  }
}

/**
 * The attributes worth printing, in the order the component declares its props.
 *
 * A value equal to what the component itself defaults to is left out. The signature already
 * says it, so printing it is noise, and a design tool that showed every default would bury the
 * two attributes that were actually chosen.
 */
function attributesOf(
  spec: PrintableSpec,
  props: Record<string, ComponentPropValue>,
): string[] {
  const attributes: string[] = []
  for (const prop of spec.props) {
    const value = props[prop.key]
    if (value === undefined) continue
    if (prop.default !== undefined && value === prop.default) continue
    const printed = printValue(value)
    if (printed === null) continue
    attributes.push(printed === '' ? prop.key : `${prop.key}=${printed}`)
  }
  return attributes
}

/** The component's call site, as it would be written in a file. */
export function printInstance(
  spec: PrintableSpec,
  props: Record<string, ComponentPropValue>,
): string {
  const attributes = attributesOf(spec, props)
  if (attributes.length === 0) return `<${spec.name} />`

  const oneLine = `<${spec.name} ${attributes.join(' ')} />`
  if (oneLine.length <= WRAP_AT) return oneLine

  return [`<${spec.name}`, ...attributes.map((attribute) => `${INDENT}${attribute}`), '/>'].join(
    '\n',
  )
}
