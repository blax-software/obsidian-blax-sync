import type { LocalFile, LocalFs, Remote, RemoteFile } from '../src/sync/types'

const enc = new TextEncoder()
const dec = new TextDecoder()
export const buf = (s: string) => enc.encode(s).buffer as ArrayBuffer
export const str = (b: ArrayBuffer) => dec.decode(b)

let clock = 1_000_000
const tick = () => (clock += 1000)

export class MemoryFs implements LocalFs {
  files = new Map<string, { data: ArrayBuffer; mtime: number }>()
  trashed: string[] = []
  constructor(init: Record<string, string> = {}) { for (const [p, c] of Object.entries(init)) this.set(p, c) }
  set(path: string, content: string) { this.files.set(path, { data: buf(content), mtime: tick() }) }
  text(path: string) { const f = this.files.get(path); return f ? str(f.data) : undefined }
  async list(): Promise<LocalFile[]> { return [...this.files].map(([path, f]) => ({ path, size: f.data.byteLength, mtime: f.mtime })) }
  async read(path: string) { const f = this.files.get(path); if (!f) throw new Error(`no ${path}`); return f.data }
  async write(path: string, data: ArrayBuffer) { this.files.set(path, { data, mtime: tick() }) }
  async trash(path: string) { this.files.delete(path); this.trashed.push(path) }
  async stat(path: string) { const f = this.files.get(path); return f ? { path, size: f.data.byteLength, mtime: f.mtime } : null }
}

/** Behaves like rclone with --no-modtime: no hashes, sizes only. */
export class MemoryRemote implements Remote {
  files = new Map<string, ArrayBuffer>()
  failPutAfter = Infinity
  puts = 0
  text(path: string) { const f = this.files.get(path); return f ? str(f) : undefined }
  async list(): Promise<RemoteFile[]> { return [...this.files].map(([path, d]) => ({ path, size: d.byteLength })) }
  async get(path: string) { return this.files.get(path) ?? null }
  async put(path: string, data: ArrayBuffer) {
    if (++this.puts > this.failPutAfter) throw new Error('network down')
    this.files.set(path, data)
  }
  async move(path: string, to: string) { const d = this.files.get(path); if (!d) return; this.files.delete(path); this.files.set(to, d) }
}
