// One sync run: scan both sides, plan, execute, record.
//
// Remote change detection uses the manifest (.blax-sync/manifest.json) with content hashes,
// because servers can't be trusted to change ETag or mtime on an edit (rclone with
// --no-modtime keeps both through same-size edits). A file whose size disagrees with the
// manifest, or that the manifest doesn't know, was changed by something else: it gets
// downloaded and hashed. After an interrupted run, the next run heals the same way.

import { hash } from './hash'
import { conflictPath, plan, type Hashes } from './plan'
import { META_DIR } from './filter'
import type { LocalFs, LocalState, Manifest, ManifestEntry, Op, Remote, SyncResult } from './types'

export const MANIFEST = `${META_DIR}/manifest.json`
export const REMOTE_TRASH = `${META_DIR}/trash`

export class DeletionGuardError extends Error {
  constructor(public local: number, public remote: number, public total: number) {
    super(`Sync stopped: it would remove ${local} local and ${remote} remote file(s) out of ${total}. ` +
      'Run "Sync now and allow large deletions" if that is intended.')
  }
}

export interface EngineOptions {
  local: LocalFs
  remote: Remote
  state: LocalState
  filter: (path: string) => boolean
  configDir: string
  allowDeletions?: boolean
  now?: () => Date
  /** Called after every few operations and at the end, to persist state. */
  saveState?: (state: LocalState) => Promise<void>
  onProgress?: (done: number, total: number) => void
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export async function readManifest(remote: Remote): Promise<Manifest> {
  const raw = await remote.get(MANIFEST)
  if (!raw) return { v: 1, rev: 0, files: {} }
  try {
    const m = JSON.parse(dec.decode(raw)) as Manifest
    if (m && m.v === 1 && typeof m.files === 'object') return m
  } catch { /* corrupt: rebuilt from the listing below */ }
  return { v: 1, rev: 0, files: {} }
}

export async function sync(o: EngineOptions): Promise<SyncResult> {
  const now = o.now ?? (() => new Date())
  const result: SyncResult = { uploaded: 0, downloaded: 0, trashedLocal: 0, trashedRemote: 0, conflicts: [], configChanged: false, errors: [] }
  const cache = new Map<string, ArrayBuffer>()   // content already read, by side+path
  const state = o.state

  // Remote side
  const startManifest = await readManifest(o.remote)
  const listing = (await o.remote.list()).filter(f => o.filter(f.path))
  const remote: Hashes = new Map()
  const remoteEntries = new Map<string, ManifestEntry>()
  for (const f of listing) {
    const m = startManifest.files[f.path]
    if (m && m.s === f.size) { remote.set(f.path, m.h); remoteEntries.set(f.path, m); continue }
    const data = await o.remote.get(f.path)   // unknown to the manifest: written by another tool
    if (!data) continue
    const h = await hash(data)
    cache.set('r:' + f.path, data)
    remote.set(f.path, h)
    remoteEntries.set(f.path, { h, s: data.byteLength, d: 'external', t: now().getTime() })
  }

  // Local side: rehash only files whose mtime or size moved since the last sync
  const local: Hashes = new Map()
  for (const f of await o.local.list()) {
    if (!o.filter(f.path)) continue
    const b = state.base[f.path]
    if (b && b.m === f.mtime && b.s === f.size) { local.set(f.path, b.h); continue }
    const data = await o.local.read(f.path)
    cache.set('l:' + f.path, data)
    local.set(f.path, await hash(data))
  }

  const base: Hashes = new Map(Object.entries(state.base).filter(([p]) => o.filter(p)).map(([p, e]) => [p, e.h]))
  const ops = plan(local, remote, base)

  const trashLocal = ops.filter(op => op.kind === 'trash-local').length
  const trashRemote = ops.filter(op => op.kind === 'trash-remote').length
  const total = new Set([...local.keys(), ...remote.keys()]).size
  const guard = (n: number) => n > 10 && n > total * 0.25
  if (!o.allowDeletions && (guard(trashLocal) || guard(trashRemote))) throw new DeletionGuardError(trashLocal, trashRemote, total)

  // Manifest changes made by this run, merged into the newest manifest at the end
  const touched = new Map<string, ManifestEntry | null>()
  const stamp = (h: string, s: number): ManifestEntry => ({ h, s, d: state.deviceId, t: now().getTime() })
  const isConfig = (p: string) => p.startsWith(o.configDir + '/')

  const getLocal = async (p: string) => cache.get('l:' + p) ?? o.local.read(p)
  const getRemote = async (p: string) => {
    const c = cache.get('r:' + p)
    if (c) return c
    const d = await o.remote.get(p)
    if (!d) throw new Error(`remote file vanished: ${p}`)
    return d
  }
  const recordBase = async (p: string, h: string) => {
    const st = await o.local.stat(p)
    if (st) state.base[p] = { h, s: st.size, m: st.mtime }
  }
  const upload = async (p: string, data: ArrayBuffer, h: string) => {
    await o.remote.put(p, data)
    touched.set(p, stamp(h, data.byteLength))
    result.uploaded++
  }
  const download = async (p: string, data: ArrayBuffer, h: string) => {
    await o.local.write(p, data)
    touched.set(p, remoteEntries.get(p) ?? stamp(h, data.byteLength))
    result.downloaded++
    if (isConfig(p)) result.configChanged = true
  }

  let done = 0
  for (const op of ops) {
    try {
      await apply(op)
    } catch (e) {
      result.errors.push(`${op.kind} ${op.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
    done++
    o.onProgress?.(done, ops.length)
    if (done % 25 === 0) await o.saveState?.(state)
  }

  async function apply(op: Op) {
    const p = op.path
    switch (op.kind) {
      case 'adopt': {
        await recordBase(p, local.get(p)!)
        if (!remoteEntries.get(p) || remoteEntries.get(p)!.d === 'external') touched.set(p, stamp(local.get(p)!, (await o.local.stat(p))?.size ?? 0))
        return
      }
      case 'upload': {
        const data = await getLocal(p)
        await upload(p, data, local.get(p)!)
        await recordBase(p, local.get(p)!)
        return
      }
      case 'download': {
        const data = await getRemote(p)
        await download(p, data, remote.get(p)!)
        await recordBase(p, remote.get(p)!)
        return
      }
      case 'trash-local': {
        await o.local.trash(p)
        delete state.base[p]
        result.trashedLocal++
        if (isConfig(p)) result.configChanged = true
        return
      }
      case 'trash-remote': {
        const day = now().toISOString().slice(0, 10)
        await o.remote.move(p, `${REMOTE_TRASH}/${day}/${p}`)
        touched.set(p, null)
        delete state.base[p]
        result.trashedRemote++
        return
      }
      case 'conflict': {
        // Keep both: the remote version lands next to the local one on every device,
        // the local version stays under the original name.
        const theirs = await getRemote(p)
        const device = remoteEntries.get(p)?.d ?? 'remote'
        const copy = conflictPath(p, device, now())
        const theirHash = remote.get(p)!
        await o.local.write(copy, theirs)
        await upload(copy, theirs, theirHash)
        await recordBase(copy, theirHash)
        const mine = await getLocal(p)
        await upload(p, mine, local.get(p)!)
        await recordBase(p, local.get(p)!)
        result.conflicts.push(copy)
        return
      }
    }
  }

  // Merge into the newest manifest: another device may have synced meanwhile.
  const fresh = await readManifest(o.remote)
  const files = fresh.rev === startManifest.rev ? { ...startManifest.files } : { ...fresh.files }
  // Entries the listing proved gone (deleted by another tool) leave the manifest too.
  if (fresh.rev === startManifest.rev) {
    for (const p of Object.keys(files)) if (o.filter(p) && !remote.has(p) && !touched.has(p)) delete files[p]
  }
  // Hashes learned for files another tool wrote; on a stale start manifest only those,
  // so a file another device removed meanwhile doesn't come back.
  for (const [p, e] of remoteEntries) if (!files[p] && !touched.has(p) && (fresh.rev === startManifest.rev || e.d === 'external')) files[p] = e
  for (const [p, e] of touched) { if (e) files[p] = e; else delete files[p] }
  const next: Manifest = { v: 1, rev: Math.max(fresh.rev, startManifest.rev) + 1, files }
  // State is saved even when the manifest write fails: the next run sees the uploaded
  // files as unknown to the manifest, hashes them, finds them equal and records them.
  try {
    if (touched.size || JSON.stringify(files) !== JSON.stringify(startManifest.files)) {
      await o.remote.put(MANIFEST, enc.encode(JSON.stringify(next)).buffer)
    }
  } finally {
    await o.saveState?.(state)
  }
  return result
}
