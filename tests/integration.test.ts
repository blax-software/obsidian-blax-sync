// Runs only when RCLONE_BIN points at an rclone binary: two devices sync through a real
// `rclone serve webdav --no-modtime` (the setup that keeps ETag and mtime through same-size
// edits), over HTTP with fetch.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sync } from '../src/sync/engine'
import { makeFilter } from '../src/sync/filter'
import { WebdavRemote, type RequestFn } from '../src/sync/webdav'
import type { LocalState } from '../src/sync/types'
import { MemoryFs } from './fakes'

const RCLONE = process.env.RCLONE_BIN
const PORT = 18000 + Math.floor(Math.random() * 900)
let proc: ChildProcess
let dir: string

const request: RequestFn = async req => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body as BodyInit | undefined })
  const arrayBuffer = await res.arrayBuffer()
  return { status: res.status, arrayBuffer, text: new TextDecoder().decode(arrayBuffer) }
}

describe.skipIf(!RCLONE)('against rclone serve webdav --no-modtime', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'blax-sync-'))
    proc = spawn(RCLONE!, ['serve', 'webdav', dir, '--addr', `127.0.0.1:${PORT}`, '--user', 'u', '--pass', 'p', '--no-modtime'], { stdio: 'ignore' })
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/`); return } catch { await new Promise(r => setTimeout(r, 100)) }
    }
  })
  afterAll(() => { proc?.kill(); rmSync(dir, { recursive: true, force: true }) })

  const device = (id: string, fs: MemoryFs) => {
    const state: LocalState = { deviceId: id, base: {} }
    const remote = new WebdavRemote({ url: `http://127.0.0.1:${PORT}`, username: 'u', password: 'p', folder: 'My Vault' }, request)
    const filter = makeFilter({ configDir: '.obsidian', syncConfig: true, ignore: [], pluginId: 'blax-sync' })
    return { fs, run: () => sync({ local: fs, remote, state, filter, configDir: '.obsidian' }) }
  }

  it('test() reports the connection and a missing folder', async () => {
    const r = await new WebdavRemote({ url: `http://127.0.0.1:${PORT}`, username: 'u', password: 'p', folder: 'My Vault' }, request).test()
    expect(r.ok).toBe(true)
    const bad = await new WebdavRemote({ url: `http://127.0.0.1:${PORT}`, username: 'u', password: 'wrong', folder: 'x' }, request).test()
    expect(bad.ok).toBe(false)
  })

  it('syncs nested, oddly named files and same-size edits between two devices', async () => {
    const A = device('desk', new MemoryFs({
      'Blax/Blax Software & Consulting.md': 'company',
      'Diary/2026/11/Tagebuch Ä ö.md': 'eintrag',
      '.obsidian/plugins/x/main.js': 'js',
    }))
    const B = device('phone', new MemoryFs({ 'from phone.md': 'p' }))
    await A.run(); await B.run(); await A.run()
    expect(B.fs.text('Diary/2026/11/Tagebuch Ä ö.md')).toBe('eintrag')
    expect(B.fs.text('.obsidian/plugins/x/main.js')).toBe('js')
    expect(A.fs.text('from phone.md')).toBe('p')

    A.fs.set('Blax/Blax Software & Consulting.md', 'COMPANY')   // same size
    await A.run(); await B.run()
    expect(B.fs.text('Blax/Blax Software & Consulting.md')).toBe('COMPANY')

    B.fs.files.delete('from phone.md')
    await B.run(); await A.run()
    expect(A.fs.text('from phone.md')).toBeUndefined()
  })
})
