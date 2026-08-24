import type {
  CodeElement,
  CodeElementEvents,
  CodeElementProps,
  CodeElementType,
} from './element.js'

/**
 * The worker's output is untrusted for the same reason a saved file is: it left this
 * process. The code that produced it is arbitrary, and arbitrary code holds the worker's
 * `postMessage` in its hands, so nothing about the runtime's own discipline survives as a
 * guarantee by the time the message arrives. This validator is the door, in the exact style
 * of `serialize.ts`: hand written, every failure naming the path that failed.
 */
export class InvalidCodeTreeError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'InvalidCodeTreeError'
  }
}

/**
 * A run may not flood the scene. The caps are generous against any sensible prototype and
 * tiny against an accident: `for (;;) children.push(...)` hits the budget, not the heap.
 */
export const MAX_ELEMENTS = 2000
export const MAX_DEPTH = 32

const ELEMENT_TYPES: readonly string[] = ['frame', 'rectangle', 'ellipse', 'text']
const EVENT_KINDS: readonly string[] = [
  'click',
  'pointerDown',
  'pointerUp',
  'pointerEnter',
  'pointerLeave',
]
const OVERFLOWS: readonly string[] = ['visible', 'hidden']
const DIRECTIONS: readonly string[] = ['row', 'column']
const ALIGNS: readonly string[] = ['start', 'center', 'end']
const JUSTIFIES: readonly string[] = ['start', 'center', 'end', 'space-between']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidCodeTreeError(`${path} is not an object`)
  return value
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidCodeTreeError(`${path} is not a finite number`)
  }
  return value
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new InvalidCodeTreeError(`${path} is not a string`)
  return value
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly string[],
  path: string,
  what: string,
): T {
  const text = requireString(value, path)
  if (!allowed.includes(text)) {
    throw new InvalidCodeTreeError(`${path} "${text}" is not ${what}`)
  }
  return text as T
}

// Six digits only, matching what `parseHex` accepts; alpha travels as `opacity`.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function requireHex(value: unknown, path: string): string {
  const text = requireString(value, path)
  if (!HEX_COLOR.test(text)) {
    throw new InvalidCodeTreeError(`${path} "${text}" is not a hex color like #rrggbb`)
  }
  return text
}

function parseSides(value: unknown, path: string): CodeElementProps['padding'] {
  if (typeof value === 'number') return requireNumber(value, path)
  const record = requireRecord(value, path)
  return {
    top: requireNumber(record['top'], `${path}.top`),
    right: requireNumber(record['right'], `${path}.right`),
    bottom: requireNumber(record['bottom'], `${path}.bottom`),
    left: requireNumber(record['left'], `${path}.left`),
  }
}

function parseCorners(value: unknown, path: string): CodeElementProps['borderRadius'] {
  if (typeof value === 'number') return requireNumber(value, path)
  const record = requireRecord(value, path)
  return {
    topLeft: requireNumber(record['topLeft'], `${path}.topLeft`),
    topRight: requireNumber(record['topRight'], `${path}.topRight`),
    bottomRight: requireNumber(record['bottomRight'], `${path}.bottomRight`),
    bottomLeft: requireNumber(record['bottomLeft'], `${path}.bottomLeft`),
  }
}

/**
 * Fields are copied one by one rather than spread, so an unknown prop is refused with its
 * name instead of riding into the document unexamined.
 */
function parseProps(value: unknown, path: string): CodeElementProps {
  const record = requireRecord(value, path)
  const props: CodeElementProps = {}
  for (const [propKey, entry] of Object.entries(record)) {
    if (entry === undefined) continue
    const at = `${path}.${propKey}`
    switch (propKey) {
      case 'x': props.x = requireNumber(entry, at); break
      case 'y': props.y = requireNumber(entry, at); break
      case 'width': props.width = requireNumber(entry, at); break
      case 'height': props.height = requireNumber(entry, at); break
      case 'background': props.background = requireHex(entry, at); break
      case 'borderColor': props.borderColor = requireHex(entry, at); break
      case 'borderWidth': props.borderWidth = requireNumber(entry, at); break
      case 'borderRadius': props.borderRadius = parseCorners(entry, at); break
      case 'opacity': props.opacity = requireNumber(entry, at); break
      case 'overflow':
        props.overflow = requireOneOf<'visible' | 'hidden'>(entry, OVERFLOWS, at, 'an overflow')
        break
      case 'direction':
        props.direction = requireOneOf<'row' | 'column'>(entry, DIRECTIONS, at, 'a direction')
        break
      case 'gap': props.gap = requireNumber(entry, at); break
      case 'padding': props.padding = parseSides(entry, at); break
      case 'align':
        props.align = requireOneOf<'start' | 'center' | 'end'>(entry, ALIGNS, at, 'an alignment')
        break
      case 'justify':
        props.justify = requireOneOf<'start' | 'center' | 'end' | 'space-between'>(
          entry, JUSTIFIES, at, 'a justification',
        )
        break
      case 'grow':
        if (typeof entry !== 'boolean') throw new InvalidCodeTreeError(`${at} is not a boolean`)
        props.grow = entry
        break
      case 'fontSize': props.fontSize = requireNumber(entry, at); break
      case 'color': props.color = requireHex(entry, at); break
      default:
        throw new InvalidCodeTreeError(`${at} is not a prop this canvas knows`)
    }
  }
  return props
}

function parseEvents(value: unknown, path: string): CodeElementEvents {
  const record = requireRecord(value, path)
  const events: CodeElementEvents = {}
  for (const [kind, entry] of Object.entries(record)) {
    if (!EVENT_KINDS.includes(kind)) {
      throw new InvalidCodeTreeError(`${path}.${kind} is not an event this canvas knows`)
    }
    if (entry !== true) {
      throw new InvalidCodeTreeError(`${path}.${kind} is declared but not true`)
    }
    events[kind as keyof CodeElementEvents] = true
  }
  return events
}

interface Budget {
  remaining: number
}

function parseElement(value: unknown, path: string, depth: number, budget: Budget): CodeElement {
  if (depth > MAX_DEPTH) {
    throw new InvalidCodeTreeError(`${path} is nested deeper than ${MAX_DEPTH} levels`)
  }
  budget.remaining -= 1
  if (budget.remaining < 0) {
    throw new InvalidCodeTreeError(`the tree holds more than ${MAX_ELEMENTS} elements`)
  }

  const record = requireRecord(value, path)
  const type = requireOneOf<CodeElementType>(
    record['type'], ELEMENT_TYPES, `${path}.type`, 'an element type',
  )

  const element: CodeElement = {
    type,
    id: requireString(record['id'], `${path}.id`),
    props: parseProps(record['props'], `${path}.props`),
  }
  if (record['key'] !== undefined) element.key = requireString(record['key'], `${path}.key`)
  if (record['name'] !== undefined) {
    element.name = requireString(record['name'], `${path}.name`)
  }
  if (record['events'] !== undefined) {
    element.events = parseEvents(record['events'], `${path}.events`)
  }
  if (record['text'] !== undefined) {
    if (type !== 'text') {
      throw new InvalidCodeTreeError(`${path}.text is only valid on a text element`)
    }
    element.text = requireString(record['text'], `${path}.text`)
  }
  if (record['children'] !== undefined) {
    if (type !== 'frame') {
      throw new InvalidCodeTreeError(`${path}.children is only valid on a frame`)
    }
    if (!Array.isArray(record['children'])) {
      throw new InvalidCodeTreeError(`${path}.children is not an array`)
    }
    element.children = record['children'].map((child, index) =>
      parseElement(child, `${path}.children[${index}]`, depth + 1, budget),
    )
  }
  return element
}

/**
 * The roots a run produced, which become the code node's direct children. Sibling ids must
 * be unique at every level, because they are the reconciler's identity: two children
 * answering to one id would collapse into a single node on the next run.
 */
export function validateCodeTree(value: unknown): CodeElement[] {
  if (!Array.isArray(value)) throw new InvalidCodeTreeError('tree is not an array')
  const budget: Budget = { remaining: MAX_ELEMENTS }
  const roots = value.map((element, index) =>
    parseElement(element, `tree[${index}]`, 1, budget),
  )
  assertUniqueIds(roots, 'tree')
  return roots
}

function assertUniqueIds(elements: readonly CodeElement[], path: string): void {
  const seen = new Set<string>()
  for (const element of elements) {
    if (seen.has(element.id)) {
      throw new InvalidCodeTreeError(
        `${path} holds two elements with the id "${element.id}"; keys must be unique among siblings`,
      )
    }
    seen.add(element.id)
    if (element.children) assertUniqueIds(element.children, `${path} > ${element.id}`)
  }
}
