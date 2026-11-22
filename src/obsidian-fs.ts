// LocalFs over Obsidian's DataAdapter. The adapter (not the Vault API) is used because it
// also reaches the config dir (.obsidian), which plugin sync needs.

import { normalizePath, type DataAdapter } from 'obsidian'
import type { LocalFile, LocalFs } from './sync/types'

export class ObsidianFs implements LocalFs {
  /** Paths written by sync recently, so the vault's change events don't trigger another run. */
  readonly recentWrites = new Map<string, number>()

  constructor(private adapter: DataAdapter, private skipDir: (dir: string) => boolean) {}

  async list(): Promise<LocalFile[]> {
    const out: LocalFile[] = []
    const queue = ['']
    while (queue.length) {
      const dir = queue.shift()!
      const listing = dir === ''
        ? await this.adapter.list('/').catch(() => this.adapter.list(''))
        : await this.adapter.list(dir)
      for (const f of listing.files) {
        const path = normalizePath(f)
        const st = await this.adapter.stat(path)
        if (st && st.type === 'file') out.push({ path, size: st.size, mtime: st.mtime })
      }
      for (const d of listing.folders) {
        const path = normalizePath(d)
        if (!this.skipDir(path)) queue.push(path)
      }
    }
    return out
  }

  read(path: string): Promise<ArrayBuffer> {
    return this.adapter.readBinary(path)
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const parts = path.split('/')
    let dir = ''
    for (const part of parts.slice(0, -1)) {
      dir = dir ? `${dir}/${part}` : part
      if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir)
    }
    this.recentWrites.set(path, Date.now())
    await this.adapter.writeBinary(path, data)
  }

  async trash(path: string): Promise<void> {
    if (!(await this.adapter.exists(path))) return
    this.recentWrites.set(path, Date.now())
    await this.adapter.trashLocal(path)
  }

  async stat(path: string): Promise<LocalFile | null> {
    const st = await this.adapter.stat(path)
    return st && st.type === 'file' ? { path, size: st.size, mtime: st.mtime } : null
  }
}
