import { describe, expect, it } from 'vitest'
import { humanizeCommand, toolSummary } from './toolSummary'

describe('toolSummary', () => {
  it('names the object a command was given', () => {
    expect(toolSummary('create_frame', { x: 0, y: 0, name: 'Header' })).toBe('Create frame Header')
    expect(toolSummary('rename_node', { nodeId: 'n1', name: 'Price' })).toBe('Rename node Price')
  })

  it('reaches the colour inside the first paint, without unpacking the paint', () => {
    // `hex` is the field `AgentPaint` actually has. The dotted-path table this replaced
    // named `color`, so every fill summary fell back to "Set fills" while a test that
    // hand-built the args passed.
    expect(toolSummary('set_fills', { nodeId: 'n1', fills: [{ hex: '#0a7cff' }] })).toBe(
      'Set fills #0a7cff',
    )
  })

  it('takes the first field that is actually there', () => {
    // create_text prefers the words themselves and falls back to the layer name.
    expect(toolSummary('create_text', { x: 0, y: 0, characters: 'Buy now' })).toBe(
      'Create text Buy now',
    )
    expect(toolSummary('create_text', { x: 0, y: 0, characters: '   ', name: 'Label' })).toBe(
      'Create text Label',
    )
  })

  it('takes a number as readily as a string', () => {
    expect(toolSummary('set_opacity', { nodeId: 'n1', opacity: 0.5 })).toBe('Set opacity 0.5')
  })

  it('collapses whitespace and truncates a long subject', () => {
    const long = 'A headline that runs on well past what a glance can take in'
    const summary = toolSummary('create_text', { x: 0, y: 0, characters: long })
    expect(summary.startsWith('Create text A headline that runs')).toBe(true)
    expect(summary.endsWith('…')).toBe(true)
    expect(summary.length).toBeLessThan(`Create text ${long}`.length)
    expect(toolSummary('create_text', { x: 0, y: 0, characters: 'two\n  words' })).toBe(
      'Create text two words',
    )
  })

  it('says how many were touched when nothing names one', () => {
    expect(toolSummary('delete_nodes', { nodeIds: ['a', 'b', 'c'] })).toBe('Delete nodes 3 layers')
    // One is the uninteresting case: the count would say less than the command alone.
    expect(toolSummary('delete_nodes', { nodeIds: ['a'] })).toBe('Delete nodes')
  })

  it('falls back to the command for anything with no entry and no count', () => {
    expect(toolSummary('get_document', {})).toBe('Get document')
    expect(toolSummary('move_node', { nodeId: 'n1', x: 10, y: 20 })).toBe('Move node')
  })

  it('survives args that are not the shape it expected', () => {
    expect(toolSummary('set_fills', { nodeId: 'n1', fills: 'nonsense' })).toBe('Set fills')
    expect(toolSummary('create_frame', null)).toBe('Create frame')
  })
})

describe('humanizeCommand', () => {
  it('reads a command name as a sentence opener', () => {
    expect(humanizeCommand('set_corner_radii')).toBe('Set corner radii')
  })
})
