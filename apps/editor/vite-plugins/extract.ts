import ts from 'typescript5'
import type { ComponentMeta, PropKind, PropMeta } from '../src/components/libraryTypes.js'

export type { ComponentMeta, PropKind, PropMeta }

/**
 * Reading a React component's props off its own source, so the properties panel is generated
 * from the code rather than written twice.
 *
 * This is the first half of "code is truth". The panel used to carry a hand written list of
 * every editable prop, its kind, its options and its default, all of which are already stated
 * in the component's own signature. Two records of one fact drift within a week, and the one
 * that drifts is always the copy: a variant added to the union would have shown up in
 * TypeScript, in the editor's autocomplete and in the component's behaviour, and nowhere in
 * the panel offering it.
 *
 * ## Why a whole TypeScript program rather than a parse
 *
 * A syntactic parse can read `variant?: 'primary' | 'secondary'` where it is written inline,
 * and this library happens to write it that way. Real components do not: they write
 * `import type { ButtonProps } from './types'`, or `Props & HTMLAttributes<HTMLButtonElement>`,
 * or a generic. Resolving those is what a type checker is for, and doing it by hand is
 * reimplementing one badly.
 *
 * Note the checker used here is TypeScript 5, pinned separately from the compiler that
 * typechecks this repo. TypeScript 7 is the native port and ships no JavaScript compiler API,
 * so there is nothing to call. It runs in the dev server and in the build, never in the
 * browser.
 */

/** `defaultOpen` to `Default open`: split on case, capitalise once, leave acronyms alone. */
export function humanise(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * A component, by this tool's reckoning: exported, named in PascalCase, and taking at most one
 * argument.
 *
 * Deliberately structural rather than "returns JSX". A component that returns a conditional,
 * a fragment or a call to another component still returns `ReactElement`, and chasing that
 * through the checker rejects real components for no gain. What this test actually excludes is
 * a helper function exported beside a component, and PascalCase is the convention that already
 * distinguishes those in every React codebase.
 */
function isComponentLike(node: ts.Node): node is ts.FunctionDeclaration {
  if (!ts.isFunctionDeclaration(node)) return false
  if (!node.name || !/^[A-Z]/.test(node.name.text)) return false
  if (node.parameters.length > 1) return false
  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
}

/**
 * The kind of control a type asks for, or null when the panel has nothing to offer.
 *
 * Null is the interesting answer. A prop typed as a function, an element or an object is a
 * real prop that this panel cannot edit, and dropping it is right: the document stores
 * scalars, so a control for anything else would be offering to write a value that could not
 * be saved. The component keeps its default for those, exactly as if it had not been told.
 */
function kindOf(type: ts.Type, checker: ts.TypeChecker): { kind: PropKind; options?: string[] } | null {
  const flags = type.getFlags()

  // Optional props arrive as `T | undefined`; the union of literals is the case that matters.
  if (type.isUnion()) {
    const parts = type.types.filter(
      (part) => !(part.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    )
    if (parts.length === 0) return null

    // Every arm a string literal is a closed set, which is a dropdown.
    if (parts.every((part) => part.isStringLiteral())) {
      return { kind: 'select', options: parts.map((part) => (part as ts.StringLiteralType).value) }
    }
    // `boolean` is itself `true | false` in the checker, so it arrives here.
    if (parts.every((part) => part.getFlags() & ts.TypeFlags.BooleanLike)) {
      return { kind: 'boolean' }
    }
    if (parts.length === 1 && parts[0]) return kindOf(parts[0], checker)
    return null
  }

  if (flags & ts.TypeFlags.BooleanLike) return { kind: 'boolean' }
  if (flags & ts.TypeFlags.NumberLike) return { kind: 'number' }
  if (flags & ts.TypeFlags.StringLike) return { kind: 'text' }
  return null
}

/** The literal value of a destructuring default, or undefined when it is not a literal. */
function literalOf(node: ts.Expression): string | number | boolean | undefined {
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  // A negative number is a prefix expression rather than a literal.
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = literalOf(node.operand)
    return typeof inner === 'number' ? -inner : undefined
  }
  return undefined
}

/**
 * Defaults, read from the destructuring pattern in the parameter list.
 *
 * `function Button({ label = 'Button' })` is where a React component says what it does when
 * it is told nothing, so it is the only honest place to read a default from. A default written
 * anywhere else, `defaultProps` or a `??` in the body, is deliberately not chased: the panel
 * would then show a value the signature does not promise.
 */
function defaultsOf(parameter: ts.ParameterDeclaration | undefined): Map<string, string | number | boolean> {
  const defaults = new Map<string, string | number | boolean>()
  if (!parameter || !parameter.name || !ts.isObjectBindingPattern(parameter.name)) return defaults

  for (const element of parameter.name.elements) {
    if (!ts.isIdentifier(element.name) || !element.initializer) continue
    const value = literalOf(element.initializer)
    if (value !== undefined) defaults.set(element.name.text, value)
  }
  return defaults
}

/** `export const canvasDefaults = { width: 220 }`, if the file declares one. */
function canvasDefaultsOf(source: ts.SourceFile): { width?: number } {
  const found: { width?: number } = {}
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'canvasDefaults') continue
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue
      for (const property of declaration.initializer.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue
        if (property.name.text !== 'width') continue
        const value = literalOf(property.initializer)
        if (typeof value === 'number') found.width = value
      }
    }
  }
  return found
}

export interface ExtractOptions {
  /** Turns an absolute path into the specifier a generated file would import it by. */
  importPathFor: (file: string) => string
}

/**
 * Every editable component in one source file.
 *
 * Returns an empty list rather than throwing for a file that holds no components, because the
 * library folder is a folder of source files and some of them are helpers.
 */
export function extractFromSource(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  options: ExtractOptions,
): ComponentMeta[] {
  const found: ComponentMeta[] = []
  const canvas = canvasDefaultsOf(source)

  for (const statement of source.statements) {
    if (!isComponentLike(statement) || !statement.name) continue

    const parameter = statement.parameters[0]
    const defaults = defaultsOf(parameter)
    const props: PropMeta[] = []

    if (parameter) {
      const propsType = checker.getTypeAtLocation(parameter)
      for (const symbol of checker.getPropertiesOfType(propsType)) {
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
        if (!declaration) continue
        const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
        const resolved = kindOf(type, checker)
        // A prop this panel cannot edit is left to the component's own default.
        if (!resolved) continue

        const fallback = defaults.get(symbol.name)
        props.push({
          key: symbol.name,
          label: humanise(symbol.name),
          kind: resolved.kind,
          ...(resolved.options ? { options: resolved.options } : {}),
          ...(fallback !== undefined ? { default: fallback } : {}),
          optional: (symbol.getFlags() & ts.SymbolFlags.Optional) !== 0,
        })
      }
    }

    const exportName = statement.name.text
    found.push({
      key: exportName.toLowerCase(),
      name: exportName,
      exportName,
      importPath: options.importPathFor(source.fileName),
      file: source.fileName,
      props,
      ...(canvas.width !== undefined ? { defaultWidth: canvas.width } : {}),
    })
  }

  return found
}

/**
 * Builds a program over `files` and extracts every component in them.
 *
 * A whole program rather than a file at a time, because that is what makes a props type
 * imported from a sibling file resolve. `node_modules` is deliberately not part of the picture
 * beyond what the files themselves reach for: this reads a component library, not a universe.
 */
export function extractComponents(files: readonly string[], options: ExtractOptions): ComponentMeta[] {
  const program = ts.createProgram([...files], {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    // Errors are not this tool's business. A file that does not compile still parses, and a
    // half typed component should degrade to fewer props rather than to no library at all.
    noResolve: false,
  })
  const checker = program.getTypeChecker()

  const found: ComponentMeta[] = []
  for (const file of files) {
    const source = program.getSourceFile(file)
    if (!source) continue
    found.push(...extractFromSource(source, checker, options))
  }
  return found
}
