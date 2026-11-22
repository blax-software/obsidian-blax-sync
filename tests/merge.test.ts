import { describe, expect, it } from 'vitest'
import { mergeJson } from '../src/sync/merge'

describe('mergeJson', () => {
  it('unions plugin lists, shared order first', () => {
    expect(JSON.parse(mergeJson('["blax-sync","mine"]', '["dataview","blax-sync"]')!)).toEqual(['dataview', 'blax-sync', 'mine'])
  })
  it('merges objects recursively, server values win', () => {
    expect(JSON.parse(mergeJson('{"a":1,"n":{"x":1,"y":2}}', '{"a":2,"n":{"y":3},"b":true}')!)).toEqual({ a: 2, n: { x: 1, y: 3 }, b: true })
  })
  it('gives up on non-JSON', () => {
    expect(mergeJson('not json', '{}')).toBeNull()
  })
})
