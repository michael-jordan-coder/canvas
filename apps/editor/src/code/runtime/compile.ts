import { transform } from 'sucrase'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from './hooks.js'
import {
  Ellipse,
  Frame,
  Rectangle,
  Text,
  __fragment,
  __jsx,
  type ComponentFn,
} from './jsx.js'

/**
 * Source to component, with no module system at all. Sucrase strips the types and turns the
 * JSX into `__jsx(...)` calls, and everything those calls need arrives as `new Function`
 * parameters: the factory, the four primitives, the hooks. There is nothing to resolve, so
 * there is no bundler in the worker and no import map to keep honest. The cost is stated
 * plainly to the user instead of half-supported: `import` throws, ambient names are the API.
 */

export class CodeCompileError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'CodeCompileError'
  }
}

function requireStub(name: string): never {
  throw new CodeCompileError(
    `import of "${name}" is not available in code nodes; Frame, Text, Rectangle, Ellipse and the hooks are ambient`,
  )
}

export function compileSource(source: string): ComponentFn {
  let compiled: string
  try {
    compiled = transform(source, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxPragma: '__jsx',
      jsxFragmentPragma: '__fragment',
      production: true,
    }).code
  } catch (error) {
    throw new CodeCompileError(error instanceof Error ? error.message : String(error))
  }

  const exports: Record<string, unknown> = {}
  try {
    const factory = new Function(
      '__jsx',
      '__fragment',
      'Frame',
      'Rectangle',
      'Ellipse',
      'Text',
      'useState',
      'useEffect',
      'useMemo',
      'useRef',
      'exports',
      'require',
      compiled,
    )
    factory(
      __jsx,
      __fragment,
      Frame,
      Rectangle,
      Ellipse,
      Text,
      useState,
      useEffect,
      useMemo,
      useRef,
      exports,
      requireStub,
    )
  } catch (error) {
    if (error instanceof CodeCompileError) throw error
    throw new CodeCompileError(error instanceof Error ? error.message : String(error))
  }

  const entry = exports['default']
  if (typeof entry !== 'function') {
    throw new CodeCompileError('code must export default a component function')
  }
  return entry as ComponentFn
}
