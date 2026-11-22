// Three-way decision per path: local hash, remote hash, and the hash both sides had at
// the last sync on this device (base). undefined = the file doesn't exist there.
//
// Edits beat deletions and conflicts keep both versions, so a sync never loses content.
// On the very first sync there is no base, which can only add files, never remove them.

import type { Op } from './types'

export type Hashes = Map<string, string>

export function plan(local: Hashes, remote: Hashes, base: Hashes): Op[] {
  const paths = new Set([...local.keys(), ...remote.keys(), ...base.keys()])
  const ops: Op[] = []
  for (const path of [...paths].sort()) {
    const l = local.get(path), r = remote.get(path), b = base.get(path)
    if (l === r) {
      if (l !== undefined && l !== b) ops.push({ kind: 'adopt', path })
      continue
    }
    if (l === b) {                       // only the remote side changed
      ops.push(r === undefined ? { kind: 'trash-local', path } : { kind: 'download', path })
    } else if (r === b) {                // only the local side changed
      ops.push(l === undefined ? { kind: 'trash-remote', path } : { kind: 'upload', path })
    } else if (l === undefined) {        // deleted here, edited there: keep the edit
      ops.push({ kind: 'download', path })
    } else if (r === undefined) {        // edited here, deleted there: keep the edit
      ops.push({ kind: 'upload', path })
    } else {
      ops.push({ kind: 'conflict', path })
    }
  }
  return ops
}

/** foo/bar.md -> foo/bar.conflict-<device>-20261122T1142.md */
export function conflictPath(path: string, device: string, when: Date): string {
  const stamp = when.toISOString().slice(0, 16).replace(/[-:]/g, '')
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  const tag = `.conflict-${device.replace(/[^A-Za-z0-9_-]/g, '')}-${stamp}`
  return dot > slash + 1 ? path.slice(0, dot) + tag + path.slice(dot) : path + tag
}
