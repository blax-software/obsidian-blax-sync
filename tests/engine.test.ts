import { describe, expect, it } from 'vitest'
import { DeletionGuardError, MANIFEST, REMOTE_TRASH, sync } from '../src/sync/engine'
import { makeFilter } from '../src/sync/filter'
import type { LocalState } from '../src/sync/types'
import { MemoryFs, MemoryRemote, buf } from './fakes'

const filter = (syncConfig = true) => makeFilter({ configDir: '.obsidian', syncConfig, ignore: [], pluginId: 'blax-sync' })

class Device {
  state: LocalState
  constructor(public id: string, public fs: MemoryFs, public remote: MemoryRemote, public syncConfig = true) {
    this.state = { deviceId: id, base: {} }
  }
  run(opts: { allowDeletions?: boolean } = {}) {
    return sync({ local: this.fs, remote: this.remote, state: this.state, filter: filter(this.syncConfig), configDir: '.obsidian', now: () => new Date('2026-11-22T11:42:00Z'), ...opts })
  }
}

function pair(a: Record<string, string> = {}, b: Record<string, string> = {}) {
  const remote = new MemoryRemote()
  return { remote, A: new Device('desk', new MemoryFs(a), remote), B: new Device('phone', new MemoryFs(b), remote) }
}

describe('sync between two devices', () => {
  it('first syncs merge both vaults without deleting anything', async () => {
    const { A, B } = pair({ 'a.md': 'from A', 'same.md': 'x' }, { 'b.md': 'from B', 'same.md': 'x' })
    await A.run(); await B.run(); await A.run()
    for (const d of [A, B]) {
      expect(d.fs.text('a.md')).toBe('from A')
      expect(d.fs.text('b.md')).toBe('from B')
      expect(d.fs.text('same.md')).toBe('x')
    }
  })

  it('carries a same-size edit that ETag/mtime-based sync would miss', async () => {
    const { A, B, remote } = pair({ 'n.md': 'hello one' })
    await A.run(); await B.run()
    A.fs.set('n.md', 'hello two')        // same length
    await A.run()
    expect(remote.text('n.md')).toBe('hello two')
    await B.run()
    expect(B.fs.text('n.md')).toBe('hello two')
  })

  it('propagates deletions to the trash on both sides, never hard-deletes', async () => {
    const { A, B, remote } = pair({ 'gone.md': 'bye', 'keep.md': 'k', 'k2.md': 'k', 'k3.md': 'k' })
    await A.run(); await B.run()
    A.fs.files.delete('gone.md')
    await A.run()
    expect(remote.text('gone.md')).toBeUndefined()
    expect(remote.text(`${REMOTE_TRASH}/2026-11-22/gone.md`)).toBe('bye')
    await B.run()
    expect(B.fs.text('gone.md')).toBeUndefined()
    expect(B.fs.trashed).toEqual(['gone.md'])
  })

  it('keeps both versions on a conflict', async () => {
    const { A, B } = pair({ 'c.md': 'base' })
    await A.run(); await B.run()
    A.fs.set('c.md', 'A edit'); B.fs.set('c.md', 'B edit, longer')
    await A.run()
    const r = await B.run()
    expect(r.conflicts).toEqual(['c.conflict-desk-20261122T1142.md'])
    expect(B.fs.text('c.md')).toBe('B edit, longer')
    expect(B.fs.text('c.conflict-desk-20261122T1142.md')).toBe('A edit')
    await A.run()
    expect(A.fs.text('c.md')).toBe('B edit, longer')
    expect(A.fs.text('c.conflict-desk-20261122T1142.md')).toBe('A edit')
  })

  it('lets an edit win over a deletion on the other side', async () => {
    const { A, B } = pair({ 'e.md': 'v1' })
    await A.run(); await B.run()
    A.fs.files.delete('e.md'); B.fs.set('e.md', 'v2')
    await B.run(); await A.run()
    expect(A.fs.text('e.md')).toBe('v2')
  })

  it('stops before a mass deletion unless allowed', async () => {
    const init = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}.md`, `c${i}`]))
    const { A, remote } = pair(init)
    await A.run()
    A.fs.files.clear()
    await expect(A.run()).rejects.toBeInstanceOf(DeletionGuardError)
    expect(remote.files.size).toBe(41)   // 40 notes + manifest, untouched
    const r = await A.run({ allowDeletions: true })
    expect(r.trashedRemote).toBe(40)
  })

  it('heals after a run that died halfway', async () => {
    const init = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.md`, `c${i}`]))
    const { A, B, remote } = pair(init)
    remote.failPutAfter = 4                     // network dies after 4 uploads
    await expect(A.run()).rejects.toThrow('network down')   // ... including the manifest write
    remote.failPutAfter = Infinity
    await A.run(); await B.run()
    expect(B.fs.files.size).toBe(10)
    expect(remote.text(MANIFEST)).toContain('f9.md')
  })

  it('picks up a file another tool wrote to the server', async () => {
    const { A, remote } = pair({ 'a.md': 'x' })
    await A.run()
    remote.files.set('outside.md', buf('written by rclone'))
    await A.run()
    expect(A.fs.text('outside.md')).toBe('written by rclone')
  })

  it('syncs plugins and settings only when enabled, never workspace or its own state', async () => {
    const cfg = {
      '.obsidian/community-plugins.json': '["x"]',
      '.obsidian/plugins/x/main.js': 'js',
      '.obsidian/workspace.json': 'layout',
      '.obsidian/plugins/blax-sync/state.json': 'local',
      'note.md': 'n',
    }
    const { A, B } = pair(cfg)
    const r1 = await A.run()
    expect(r1.uploaded).toBe(3)
    const r2 = await B.run()
    expect(B.fs.text('.obsidian/plugins/x/main.js')).toBe('js')
    expect(B.fs.text('.obsidian/workspace.json')).toBeUndefined()
    expect(r2.configChanged).toBe(true)

    const remote = new MemoryRemote()
    const C = new Device('c', new MemoryFs(cfg), remote, false)
    await C.run()
    expect([...remote.files.keys()].filter(p => p.startsWith('.obsidian'))).toEqual([])
  })

  it('a new device adopts the shared plugins and settings instead of making conflict copies', async () => {
    const { A, B } = pair(
      { '.obsidian/community-plugins.json': '["blax-sync","x"]', '.obsidian/app.json': '{"vimMode":true,"spellcheck":false}', '.obsidian/plugins/x/main.js': 'js' },
      { '.obsidian/community-plugins.json': '["blax-sync"]', '.obsidian/app.json': '{"spellcheck":true,"newOnly":1}' })
    await A.run()
    const r = await B.run()
    expect(r.conflicts).toEqual([])
    expect(JSON.parse(B.fs.text('.obsidian/community-plugins.json')!)).toEqual(['blax-sync', 'x'])
    expect(JSON.parse(B.fs.text('.obsidian/app.json')!)).toEqual({ spellcheck: false, newOnly: 1, vimMode: true })
    expect(r.configChanged).toBe(true)
    expect([...B.fs.files.keys()].some(p => p.includes('.conflict-'))).toBe(false)
    await A.run()
    expect(JSON.parse(A.fs.text('.obsidian/app.json')!)).toEqual({ spellcheck: false, newOnly: 1, vimMode: true })
  })

  it('merges manifests when two devices finish around the same time', async () => {
    const { A, B, remote } = pair({ 'a.md': 'a' }, { 'b.md': 'b' })
    await A.run(); await B.run(); await A.run()
    A.fs.set('a2.md', 'new A'); B.fs.set('b2.md', 'new B')
    await Promise.all([A.run(), B.run()])
    await A.run(); await B.run()
    const manifest = JSON.parse(remote.text(MANIFEST)!)
    expect(Object.keys(manifest.files).sort()).toEqual(['a.md', 'a2.md', 'b.md', 'b2.md'])
    expect(A.fs.text('b2.md')).toBe('new B')
    expect(B.fs.text('a2.md')).toBe('new A')
  })
})
