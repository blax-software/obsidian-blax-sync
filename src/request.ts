import { requestUrl } from 'obsidian'
import type { RequestFn } from './sync/webdav'

// requestUrl bypasses CORS and works on mobile; throw:false hands every status back.
export const obsidianRequest: RequestFn = async req => {
  const res = await requestUrl({ url: req.url, method: req.method, headers: req.headers, body: req.body, throw: false })
  let text = ''
  try { text = res.text } catch { /* binary body */ }
  return { status: res.status, arrayBuffer: res.arrayBuffer, text }
}
