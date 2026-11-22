// The sync engine only talks to these two interfaces, so it runs the same against
// Obsidian's vault adapter, a WebDAV server, or in-memory fakes in the tests.

export interface LocalFile {
  path: string
  size: number
  mtime: number
}

export interface LocalFs {
  /** Every file under the vault root, config dir included; the engine filters. */
  list(): Promise<LocalFile[]>
  read(path: string): Promise<ArrayBuffer>
  /** Creates missing parent folders. */
  write(path: string, data: ArrayBuffer): Promise<void>
  /** Recoverable removal (Obsidian: the vault's .trash). */
  trash(path: string): Promise<void>
  /** mtime/size after a write, so the next scan can skip hashing the file. */
  stat(path: string): Promise<LocalFile | null>
}

export interface RemoteFile {
  path: string
  size: number
}

export interface Remote {
  /** Every file under the sync root, recursively, paths relative to it. */
  list(): Promise<RemoteFile[]>
  /** null when the file doesn't exist. */
  get(path: string): Promise<ArrayBuffer | null>
  /** Creates missing parent folders. */
  put(path: string, data: ArrayBuffer): Promise<void>
  /** Recoverable removal: moves the file to `to` instead of deleting it. */
  move(path: string, to: string): Promise<void>
}

/** What the last successful sync saw for a path, kept on each device. */
export interface BaseEntry {
  h: string    // content hash
  s: number    // size
  m: number    // local mtime at that time, lets a scan skip unchanged files
}

export interface LocalState {
  deviceId: string
  base: Record<string, BaseEntry>
}

/** Remote manifest: content hashes for every file, written by every device. */
export interface ManifestEntry {
  h: string
  s: number
  d: string    // device that wrote it
  t: number    // when (ms)
}

export interface Manifest {
  v: 1
  rev: number
  files: Record<string, ManifestEntry>
}

export type Op =
  | { kind: 'upload'; path: string }
  | { kind: 'download'; path: string }
  | { kind: 'trash-local'; path: string }
  | { kind: 'trash-remote'; path: string }
  | { kind: 'conflict'; path: string }
  | { kind: 'adopt'; path: string }   // same content on both sides: just record it

export interface SyncResult {
  uploaded: number
  downloaded: number
  trashedLocal: number
  trashedRemote: number
  conflicts: string[]
  configChanged: boolean
  errors: string[]
  /** Dry runs only: what a real run would do, nothing applied. */
  planned?: Op[]
}
