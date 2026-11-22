// Minimal WebDAV client over an injected request function: Obsidian's requestUrl in the
// plugin (no CORS, works on mobile), fetch in the tests. Only what sync needs:
// PROPFIND, GET, PUT, MKCOL, MOVE.

import type { Remote, RemoteFile } from './types'

export interface HttpRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: ArrayBuffer | string
}
export interface HttpResponse {
  status: number
  arrayBuffer: ArrayBuffer
  text: string
}
export type RequestFn = (req: HttpRequest) => Promise<HttpResponse>

export interface WebdavConfig {
  url: string        // server, e.g. https://dav.example.com or https://cloud.example.com/remote.php/dav/files/me
  username: string
  password: string
  folder: string     // folder on the server that holds the vault, e.g. "Obsidian Vault"
}

const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>'

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const encodePath = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/')
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&')

export interface DavEntry { href: string; collection: boolean; size: number }

/** Parses a 207 multistatus body. Tolerates any namespace prefix (d:, D:, lp1:, none). */
export function parseMultistatus(xml: string): DavEntry[] {
  const out: DavEntry[] = []
  const tag = (name: string) => `<(?:[\\w-]+:)?${name}\\b[^>]*>`
  const responseRe = new RegExp(`${tag('response')}([\\s\\S]*?)<\\/(?:[\\w-]+:)?response>`, 'g')
  for (const m of xml.matchAll(responseRe)) {
    const body = m[1]
    const href = body.match(new RegExp(`${tag('href')}([^<]*)<`))
    if (!href) continue
    // A propstat may carry 404 for a single missing property; only a response-level
    // status without any propstat marks the whole entry as failed.
    if (!new RegExp(tag('propstat')).test(body)) {
      const status = body.match(new RegExp(`${tag('status')}([^<]*)<`))
      if (status && !/\s2\d\d\s/.test(` ${status[1]} `)) continue
    }
    const collection = new RegExp(`<(?:[\\w-]+:)?collection\\b`).test(body)
    const len = body.match(new RegExp(`${tag('getcontentlength')}\\s*(\\d+)\\s*<`))
    out.push({ href: decodeXml(href[1].trim()), collection, size: len ? +len[1] : 0 })
  }
  return out
}

export class WebdavRemote implements Remote {
  private base: string          // folder URL with trailing slash
  private basePath: string      // decoded pathname of base, for matching hrefs
  private auth: string
  private known = new Set<string>()   // collections known to exist

  constructor(private cfg: WebdavConfig, private request: RequestFn) {
    const server = cfg.url.replace(/\/+$/, '')
    const folder = encodePath(cfg.folder)
    this.base = `${server}/${folder ? folder + '/' : ''}`
    this.basePath = decodeURIComponent(new URL(this.base).pathname)
    this.auth = 'Basic ' + b64(`${cfg.username}:${cfg.password}`)
  }

  private url(path: string, collection = false) {
    const p = encodePath(path)
    return this.base + p + (collection && p ? '/' : '')
  }

  private async call(method: string, url: string, headers: Record<string, string> = {}, body?: ArrayBuffer | string) {
    return this.request({ url, method, headers: { Authorization: this.auth, ...headers }, body })
  }

  private rel(href: string): string | null {
    let p = href
    try { p = decodeURIComponent(new URL(href, this.base).pathname) } catch { /* keep raw */ }
    if (!p.startsWith(this.basePath)) return null
    return p.slice(this.basePath.length).replace(/\/+$/, '')
  }

  private async propfind(path: string, depth: '0' | '1' | 'infinity') {
    const res = await this.call('PROPFIND', this.url(path, true), { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' }, PROPFIND_BODY)
    return res
  }

  /** Connection check for the wizard: credentials, server, and what the folder holds. */
  async test(): Promise<{ ok: boolean; message: string; files?: number; folderExists?: boolean }> {
    let res: HttpResponse
    try {
      res = await this.call('PROPFIND', this.cfg.url.replace(/\/+$/, '') + '/', { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, PROPFIND_BODY)
    } catch (e) {
      return { ok: false, message: `Can't reach the server: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'The server refused the username or password.' }
    if (res.status !== 207) return { ok: false, message: `The server answered ${res.status}; is this a WebDAV URL?` }
    const folder = await this.propfind('', '1')
    if (folder.status === 404) return { ok: true, message: `Connected. The folder "${this.cfg.folder}" doesn't exist yet and will be created.`, files: 0, folderExists: false }
    if (folder.status !== 207) return { ok: false, message: `Connected, but the folder answered ${folder.status}.` }
    const n = parseMultistatus(folder.text).filter(e => this.rel(e.href)).length
    return { ok: true, message: `Connected. "${this.cfg.folder}" has ${n} item(s) at the top level.`, files: n, folderExists: true }
  }

  async list(): Promise<RemoteFile[]> {
    const res = await this.propfind('', 'infinity')
    if (res.status === 404) return []
    if (res.status === 207) {
      const files: RemoteFile[] = []
      for (const e of parseMultistatus(res.text)) {
        const p = this.rel(e.href)
        if (p === null || p === '') continue
        if (e.collection) this.known.add(p); else files.push({ path: p, size: e.size })
      }
      return files
    }
    // Depth: infinity refused (403/400 on many servers): walk folder by folder.
    const files: RemoteFile[] = []
    const queue = ['']
    while (queue.length) {
      const dir = queue.shift()!
      const r = await this.propfind(dir, '1')
      if (r.status === 404) continue
      if (r.status !== 207) throw new Error(`PROPFIND ${dir || '/'} answered ${r.status}`)
      for (const e of parseMultistatus(r.text)) {
        const p = this.rel(e.href)
        if (p === null || p === '' || p === dir) continue
        if (e.collection) { this.known.add(p); queue.push(p) } else files.push({ path: p, size: e.size })
      }
    }
    return files
  }

  async get(path: string): Promise<ArrayBuffer | null> {
    const res = await this.call('GET', this.url(path))
    if (res.status === 404) return null
    if (res.status < 200 || res.status >= 300) throw new Error(`GET ${path} answered ${res.status}`)
    return res.arrayBuffer
  }

  private async ensureDir(dir: string) {
    if (!dir || this.known.has(dir)) return
    const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
    await this.ensureDir(parent)
    if (!parent && !this.known.has('')) {   // the sync folder itself
      const root = await this.call('MKCOL', this.base)
      if (![201, 405, 301].includes(root.status) && root.status >= 300) throw new Error(`MKCOL / answered ${root.status}`)
      this.known.add('')
    }
    const res = await this.call('MKCOL', this.url(dir, true))
    if (![201, 405, 301].includes(res.status) && res.status >= 300) throw new Error(`MKCOL ${dir} answered ${res.status}`)
    this.known.add(dir)
  }

  async put(path: string, data: ArrayBuffer): Promise<void> {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (dir) await this.ensureDir(dir)
    else if (!this.known.has('')) { await this.call('MKCOL', this.base); this.known.add('') }
    const res = await this.call('PUT', this.url(path), { 'Content-Type': 'application/octet-stream' }, data)
    if (res.status < 200 || res.status >= 300) throw new Error(`PUT ${path} answered ${res.status}`)
  }

  async move(path: string, to: string): Promise<void> {
    const dir = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : ''
    await this.ensureDir(dir)
    const res = await this.call('MOVE', this.url(path), { Destination: this.url(to), Overwrite: 'T' })
    if (res.status === 404) return
    if (res.status < 200 || res.status >= 300) throw new Error(`MOVE ${path} answered ${res.status}`)
  }
}
