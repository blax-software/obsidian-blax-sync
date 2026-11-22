// A second "device" for the mobile test: the plugin's own engine, a folder on disk as vault.
//   node desk-sim.mjs <vaultDir> <davUrl> <folder> [--dry-run]   one sync (or a plan), prints the result
// Credentials: DAV_USER / DAV_PASS (default u / p, the e2e server).
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { sync } from '../src/sync/engine'
import { makeFilter } from '../src/sync/filter'
import { WebdavRemote, type RequestFn } from '../src/sync/webdav'
import type { LocalFs, LocalState } from '../src/sync/types'

const [root, url, folder] = process.argv.slice(2)
const dryRun = process.argv.includes('--dry-run')
const statePath = join(root, '..', 'desk-sim-state.json')
const disk: LocalFs = {
  async list() {
    const out: { path: string; size: number; mtime: number }[] = []
    const walk = async (d: string) => {
      for (const e of await fs.readdir(join(root, d), { withFileTypes: true })) {
        const p = d ? `${d}/${e.name}` : e.name
        if (e.isDirectory()) await walk(p)
        else { const s = await fs.stat(join(root, p)); out.push({ path: p, size: s.size, mtime: Math.floor(s.mtimeMs) }) }
      }
    }
    await walk('')
    return out
  },
  async read(p) { const b = await fs.readFile(join(root, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer },
  async write(p, d) { await fs.mkdir(dirname(join(root, p)), { recursive: true }); await fs.writeFile(join(root, p), Buffer.from(d)) },
  async trash(p) { await fs.mkdir(dirname(join(root, '.trash', p)), { recursive: true }); await fs.rename(join(root, p), join(root, '.trash', p)) },
  async stat(p) { try { const s = await fs.stat(join(root, p)); return { path: p, size: s.size, mtime: Math.floor(s.mtimeMs) } } catch { return null } },
}
const request: RequestFn = async r => {
  const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body as BodyInit | undefined })
  const arrayBuffer = await res.arrayBuffer()
  return { status: res.status, arrayBuffer, text: new TextDecoder().decode(arrayBuffer) }
}
let state: LocalState = { deviceId: 'desk-sim', base: {} }
try { state = JSON.parse(await fs.readFile(statePath, 'utf8')) } catch {}
const r = await sync({
  local: disk, remote: new WebdavRemote({ url, username: process.env.DAV_USER ?? 'u', password: process.env.DAV_PASS ?? 'p', folder }, request), state, dryRun,
  filter: makeFilter({ configDir: '.obsidian', syncConfig: true, ignore: [], pluginId: 'blax-sync' }), configDir: '.obsidian',
  saveState: async s => { if (!dryRun) await fs.writeFile(statePath, JSON.stringify(s)) },
})
console.log(JSON.stringify(r))
