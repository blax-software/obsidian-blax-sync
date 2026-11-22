import { describe, expect, it } from 'vitest'
import { conflictPath, plan } from '../src/sync/plan'

const m = (o: Record<string, string>) => new Map(Object.entries(o))
const one = (l?: string, r?: string, b?: string) =>
  plan(m(l ? { f: l } : {}), m(r ? { f: r } : {}), m(b ? { f: b } : {}))[0]?.kind ?? 'none'

describe('plan', () => {
  it.each([
    // local, remote, base -> op
    ['a', 'a', 'a', 'none'],
    ['a', 'a', undefined, 'adopt'],
    ['b', 'a', 'a', 'upload'],
    ['a', 'b', 'a', 'download'],
    [undefined, 'a', 'a', 'trash-remote'],
    ['a', undefined, 'a', 'trash-local'],
    ['a', undefined, undefined, 'upload'],
    [undefined, 'a', undefined, 'download'],
    [undefined, 'b', 'a', 'download'],        // deleted here, edited there: edit wins
    ['b', undefined, 'a', 'upload'],          // edited here, deleted there: edit wins
    ['b', 'c', 'a', 'conflict'],
    ['b', 'c', undefined, 'conflict'],        // first sync, both sides differ
    [undefined, undefined, 'a', 'none'],      // deleted on both sides
  ])('local %s remote %s base %s -> %s', (l, r, b, op) => {
    expect(one(l, r, b)).toBe(op)
  })

  it('never removes anything on a first sync', () => {
    const ops = plan(m({ a: '1', b: '2' }), m({ b: '3', c: '4' }), new Map())
    expect(ops.map(o => o.kind)).not.toContain('trash-local')
    expect(ops.map(o => o.kind)).not.toContain('trash-remote')
  })
})

describe('conflictPath', () => {
  const when = new Date('2026-11-22T11:42:00Z')
  it('puts the tag before the extension', () => {
    expect(conflictPath('notes/a.md', 'mobile-abc', when)).toBe('notes/a.conflict-mobile-abc-20261122T1142.md')
  })
  it('handles dotfiles and names without extension', () => {
    expect(conflictPath('dir/.hidden', 'x', when)).toBe('dir/.hidden.conflict-x-20261122T1142')
    expect(conflictPath('README', 'x', when)).toBe('README.conflict-x-20261122T1142')
  })
})
