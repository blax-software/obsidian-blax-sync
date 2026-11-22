import { describe, expect, it } from 'vitest'
import { parseMultistatus, WebdavRemote, type HttpRequest } from '../src/sync/webdav'
import { globToRegExp, makeFilter } from '../src/sync/filter'

const rclone = `<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/Obsidian%20Vault/</D:href><D:propstat><D:prop><D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:response><D:href>/Obsidian%20Vault/Blax/Blax%20Software%20&amp;%20Consulting.md</D:href><D:propstat><D:prop><D:resourcetype></D:resourcetype><D:getcontentlength>1031</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`

const nextcloud = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:href>/remote.php/dav/files/me/Vault/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getcontentlength/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response><d:response><d:href>/remote.php/dav/files/me/Vault/n%C3%B6tes.md</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`

describe('parseMultistatus', () => {
  it('reads rclone output with D: prefix and escaped names', () => {
    const e = parseMultistatus(rclone)
    expect(e).toEqual([
      { href: '/Obsidian%20Vault/', collection: true, size: 0 },
      { href: '/Obsidian%20Vault/Blax/Blax%20Software%20&%20Consulting.md', collection: false, size: 1031 },
    ])
  })
  it('keeps a collection whose getcontentlength propstat is 404 (Nextcloud)', () => {
    const e = parseMultistatus(nextcloud)
    expect(e.map(x => x.collection)).toEqual([true, false])
    expect(e[1].size).toBe(12)
  })
})

describe('WebdavRemote', () => {
  const make = (status: number, text: string) => {
    const calls: HttpRequest[] = []
    const remote = new WebdavRemote({ url: 'https://cloud.example.com/remote.php/dav/files/me/', username: 'me', password: 'pä', folder: 'Vault' },
      async req => { calls.push(req); return { status, text, arrayBuffer: new ArrayBuffer(0) } })
    return { remote, calls }
  }
  it('lists relative paths, decoded, files only', async () => {
    const { remote, calls } = make(207, nextcloud)
    expect(await remote.list()).toEqual([{ path: 'nötes.md', size: 12 }])
    expect(calls[0].method).toBe('PROPFIND')
    expect(calls[0].headers.Depth).toBe('infinity')
    expect(calls[0].url).toBe('https://cloud.example.com/remote.php/dav/files/me/Vault/')
    expect(calls[0].headers.Authorization).toBe('Basic ' + Buffer.from('me:pä').toString('base64'))
  })
  it('falls back to folder-by-folder listing when Depth: infinity is refused', async () => {
    let n = 0
    const remote = new WebdavRemote({ url: 'https://dav.example.com', username: 'u', password: 'p', folder: 'V' }, async req => {
      n++
      if (req.headers.Depth === 'infinity') return { status: 403, text: '', arrayBuffer: new ArrayBuffer(0) }
      const body = req.url.endsWith('/V/')
        ? '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/V/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/V/sub/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/V/a.md</d:href><d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>'
        : '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/V/sub/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/V/sub/b.md</d:href><d:propstat><d:prop><d:getcontentlength>4</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>'
      return { status: 207, text: body, arrayBuffer: new ArrayBuffer(0) }
    })
    expect((await remote.list()).map(f => f.path).sort()).toEqual(['a.md', 'sub/b.md'])
    expect(n).toBe(3)
  })
})

describe('filter', () => {
  const f = makeFilter({ configDir: '.obsidian', syncConfig: true, ignore: ['Private/**', '*.tmp'], pluginId: 'blax-sync' })
  it.each([
    ['notes/a.md', true], ['Private/diary.md', false], ['x.tmp', false], ['dir/x.tmp', true],
    ['.trash/old.md', false], ['.blax-sync/manifest.json', false], ['.obsidian/app.json', true],
    ['.obsidian/workspace.json', false], ['.obsidian/plugins/blax-sync/state.json', false],
    ['.obsidian/plugins/blax-sync/data.json', true], ['_remotely-save-metadata-on-remote.json', false],
  ])('%s -> %s', (p, ok) => expect(f(p)).toBe(ok))
  it('globs', () => {
    expect(globToRegExp('**/*.png').test('a/b/c.png')).toBe(true)
    expect(globToRegExp('*.png').test('a/c.png')).toBe(false)
  })
})
