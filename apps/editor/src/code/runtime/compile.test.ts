import { describe, expect, it } from 'vitest'
import { CodeCompileError, compileSource } from './compile.js'
import { createSession, renderTree } from './render.js'

describe('compileSource', () => {
  it('compiles JSX with TypeScript syntax to a runnable component', () => {
    const entry = compileSource(`
      interface Props { labels?: string[] }
      export default function App(props: Props) {
        const labels = props.labels ?? ['a', 'b']
        return (
          <Frame direction="row" gap={8}>
            {labels.map((label) => (
              <Text key={label} fontSize={14}>{label}</Text>
            ))}
          </Frame>
        )
      }
    `)
    const { roots } = renderTree(entry, {}, createSession(() => {}))
    expect(roots[0]?.children?.map((child) => child.text)).toEqual(['a', 'b'])
  })

  it('lets hooks and primitives arrive ambiently, with no imports', () => {
    const entry = compileSource(`
      export default function App() {
        const [open] = useState(true)
        return open ? <Rectangle width={10} height={10} /> : null
      }
    `)
    const { roots } = renderTree(entry, {}, createSession(() => {}))
    expect(roots[0]?.type).toBe('rectangle')
  })

  it('reports a syntax error as a compile error', () => {
    expect(() => compileSource('export default function ( {')).toThrow(CodeCompileError)
  })

  it('requires a default export that is a function', () => {
    expect(() => compileSource('const x = 1')).toThrow(/export default a component/)
  })

  it('turns an import that is actually used into a friendly refusal', () => {
    // An unused import is elided by the transform, which is fine: nothing was needed.
    expect(() => compileSource(`
      import { motion } from 'framer-motion'
      export default function App() { return motion.div }
    `)).toThrow(/not available in code nodes/)
  })

  it('surfaces what user code throws, message intact', () => {
    expect(() => compileSource(`
      throw new Error('deliberate')
    `)).toThrow(/deliberate/)
  })
})
