import { describe, expect, it } from 'vitest'
import { useEffect, useState } from './hooks.js'
import { Frame, Rectangle, Text, __jsx, type ComponentFn, type VChild } from './jsx.js'
import { createSession, disposeSession, renderTree, type Session } from './render.js'

/** A session whose rerender requests are just counted; tests re-render by calling again. */
function session(): Session & { rerenders: () => number } {
  let count = 0
  const s = createSession(() => {
    count += 1
  })
  return Object.assign(s, { rerenders: () => count })
}

describe('renderTree', () => {
  it('flattens components, fragments and lists into elements with key paths', () => {
    const Card: ComponentFn = (props) =>
      __jsx(Frame, { padding: 10 }, __jsx(Text, null, String(props['label'])))

    const App: ComponentFn = () =>
      __jsx(
        Frame,
        { direction: 'row', gap: 8 },
        ['Home', 'Search'].map((label) => __jsx(Card, { key: label, label })),
      )

    const { roots } = renderTree(App, {}, session())
    expect(roots).toHaveLength(1)
    const row = roots[0]
    expect(row?.id).toBe('root')
    expect(row?.children?.map((child) => child.id)).toEqual(['root/Home', 'root/Search'])
    // The component boundary leaves no element: the card's frame takes the card's path.
    expect(row?.children?.[0]?.children?.[0]?.id).toBe('root/Home/0')
    expect(row?.children?.[0]?.children?.[0]?.text).toBe('Home')
  })

  it('keeps state across re-renders and resets it when the path dies', () => {
    let latest = -1
    const Counter: ComponentFn = () => {
      const [count, setCount] = useState(0)
      latest = count
      return __jsx(Rectangle, { onClick: () => setCount(count + 1) })
    }

    const s = session()
    const first = renderTree(Counter, {}, s)
    expect(latest).toBe(0)

    first.handlers.get('root')?.click?.({ x: 0, y: 0 })
    expect(s.rerenders()).toBe(1)
    renderTree(Counter, {}, s)
    expect(latest).toBe(1)

    // A render that no longer reaches the component unmounts it, state and all.
    const Empty: ComponentFn = () => null
    renderTree(Empty, {}, s)
    renderTree(Counter, {}, s)
    expect(latest).toBe(0)
  })

  it('keeps a keyed item state through a reorder, which is what keys are for', () => {
    const seen = new Map<string, number>()
    const Item: ComponentFn = (props) => {
      const label = String(props['label'])
      const [count, setCount] = useState(0)
      seen.set(label, count)
      return __jsx(Rectangle, { onClick: () => setCount(count + 1) })
    }
    const List = (order: string[]): ComponentFn => () =>
      __jsx(Frame, null, order.map((label) => __jsx(Item, { key: label, label })))

    const s = session()
    const first = renderTree(List(['a', 'b']), {}, s)
    first.handlers.get('root/a')?.click?.({ x: 0, y: 0 })

    renderTree(List(['b', 'a']), {}, s)
    expect(seen.get('a')).toBe(1)
    expect(seen.get('b')).toBe(0)
  })

  it('runs effects on dep change and their cleanups on the way out', () => {
    const log: string[] = []
    const App: ComponentFn = (props) => {
      const dep = props['dep'] as number
      useEffect(() => {
        log.push(`run ${dep}`)
        return () => log.push(`clean ${dep}`)
      }, [dep])
      return __jsx(Rectangle, null)
    }

    const s = session()
    renderTree(App, { dep: 1 }, s).effects.forEach((task) => task.run())
    renderTree(App, { dep: 1 }, s).effects.forEach((task) => task.run())
    renderTree(App, { dep: 2 }, s).effects.forEach((task) => task.run())
    disposeSession(s)

    expect(log).toEqual(['run 1', 'clean 1', 'run 2', 'clean 2'])
  })

  it('collects handlers by path and marks the element with flags only', () => {
    const App: ComponentFn = () =>
      __jsx(Frame, null, __jsx(Rectangle, { key: 'hit', onPointerDown: () => {} }))
    const { roots, handlers } = renderTree(App, {}, session())
    expect(roots[0]?.children?.[0]?.events).toEqual({ pointerDown: true })
    expect(handlers.get('root/hit')?.pointerDown).toBeTypeOf('function')
    // Flags, not functions: this tree has to survive a structured clone.
    expect(JSON.stringify(roots)).not.toContain('function')
  })

  it('hands the component its props and children', () => {
    const Wrap: ComponentFn = (props) => __jsx(Frame, { gap: 4 }, props['children'] as VChild)
    const App: ComponentFn = () => __jsx(Wrap, null, __jsx(Rectangle, null))
    const { roots } = renderTree(App, {}, session())
    expect(roots[0]?.children).toHaveLength(1)
  })

  it('refuses text outside <Text>, naming the text', () => {
    const App: ComponentFn = () => __jsx(Frame, null, 'loose words')
    expect(() => renderTree(App, {}, session())).toThrow(/can only appear inside <Text>/)
  })

  it('refuses children on a leaf', () => {
    const App: ComponentFn = () => __jsx(Rectangle, null, __jsx(Rectangle, null))
    expect(() => renderTree(App, {}, session())).toThrow(/only <Frame> takes children/)
  })

  it('keeps hook state apart for a component chain that shares one path', () => {
    const inner: number[] = []
    const outer: number[] = []
    const Inner: ComponentFn = () => {
      const [count] = useState(1)
      inner.push(count)
      return __jsx(Rectangle, null)
    }
    const Outer: ComponentFn = () => {
      const [count] = useState(2)
      outer.push(count)
      // Single-root output, so Inner collapses onto Outer's own path.
      return __jsx(Inner, null)
    }
    const s = session()
    renderTree(Outer, {}, s)
    renderTree(Outer, {}, s)
    expect(inner).toEqual([1, 1])
    expect(outer).toEqual([2, 2])
  })

  it('escapes a separator inside a key so paths stay one level per element', () => {
    const App: ComponentFn = () =>
      __jsx(
        Frame,
        null,
        ['docs/readme', 'a%b'].map((key) => __jsx(Rectangle, { key })),
      )
    const ids = renderTree(App, {}, session()).roots[0]?.children?.map((child) => child.id)
    // One separator between parent and child, whatever the key holds: bubbling walks these
    // paths by cutting at the last '/', so a raw one would name an ancestor that never was.
    expect(ids).toEqual(['root/docs%2Freadme', 'root/a%25b'])
  })

  it('runs the cleanup of an effect the hook order drops', () => {
    let torn = 0
    const Flipping: ComponentFn = (props) => {
      if (props['withState']) useState(0)
      useEffect(() => () => {
        torn += 1
      }, [])
      return __jsx(Rectangle, null)
    }
    const s = session()
    const first = renderTree(Flipping, { withState: false }, s)
    for (const task of first.effects) task.run()
    // The extra hook shifts the effect's index, which resets the cells at and after it. The
    // cleanup is the only reference to what the effect started, so it has to run on the way.
    const second = renderTree(Flipping, { withState: true }, s)
    expect(torn).toBe(1)
    for (const task of second.effects) task.run()
    disposeSession(s)
    expect(torn).toBe(2)
  })

  it('refuses hooks outside a render', () => {
    expect(() => useState(0)).toThrow(/while a component renders/)
  })
})
