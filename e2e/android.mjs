// Android end-to-end: Obsidian 1.15.1 on the emulator (driven over WebView CDP) syncs with a
// simulated desktop (the plugin's own engine on a folder) through rclone serve webdav --no-modtime.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const REPO = new URL('..', import.meta.url).pathname
const H = process.env.E2E_DIR ?? join(tmpdir(), 'blax-sync-e2e')
mkdirSync(join(H, 'shots'), { recursive: true })
const A = H, RUN = join(A, 'android-run'), DESK = join(RUN, 'desk'), DAV = join(RUN, 'dav')
const PORT = 18095, URL_ = `http://127.0.0.1:${PORT}`, FOLDER = 'Shared Vault'
const PLUGIN = process.env.PLUGIN_DIR ?? REPO
const results = []
const log = (...a) => console.log('[mobile]', ...a)
const check = (n, ok, d = '') => { results.push({ n, ok }); log(ok ? 'PASS' : 'FAIL', n, d) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const desk = () => JSON.parse(execFileSync('node', [join(A, 'desk-sim.mjs'), DESK, URL_, FOLDER]).toString().trim().split('\n').pop())
const deskWrite = (p, c) => { mkdirSync(join(DESK, p, '..'), { recursive: true }); writeFileSync(join(DESK, p), c) }
const deskRead = p => existsSync(join(DESK, p)) ? readFileSync(join(DESK, p), 'utf8') : null

rmSync(RUN, { recursive: true, force: true }); mkdirSync(DESK, { recursive: true }); mkdirSync(DAV, { recursive: true })
// The simulated desktop is the plugin's own engine, bundled from this repo
execFileSync(join(REPO, 'node_modules/.bin/esbuild'), [join(REPO, 'e2e/desk-sim.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${join(A, 'desk-sim.mjs')}`, '--log-level=warning'])
rmSync(join(A, 'desk-sim-state.json'), { force: true }); rmSync(join(RUN, 'desk-sim-state.json'), { force: true })
const dav = spawn(process.env.RCLONE_BIN, ['serve', 'webdav', DAV, '--addr', `127.0.0.1:${PORT}`, '--user', 'u', '--pass', 'p', '--no-modtime'], { stdio: 'ignore', detached: true })
let browser
try {
  await sleep(1000)
  execFileSync('adb', ['reverse', `tcp:${PORT}`, `tcp:${PORT}`])

  // Desktop side seeds the server: notes plus a plugin
  deskWrite('Notes/Hello.md', 'hello one'); deskWrite('Notes/Tagebuch Ä ö & co.md', '# Umlaute\n'); deskWrite('Projects/Plan.md', 'plan')
  deskWrite('.obsidian/plugins/hello-test/manifest.json', JSON.stringify({ id: 'hello-test', name: 'Hello test', version: '1.0.0', minAppVersion: '0.15.0', description: 'Test.', author: 'e2e', isDesktopOnly: false }))
  deskWrite('.obsidian/plugins/hello-test/main.js', "const {Plugin}=require('obsidian');module.exports=class extends Plugin{onload(){window.__helloTest=true}}")
  deskWrite('.obsidian/community-plugins.json', JSON.stringify(['blax-sync', 'hello-test']))
  log('desk seed:', JSON.stringify(desk()))

  // Phone: install the plugin through Obsidian's own file API, enable it
  const sock = execFileSync('adb', ['shell', 'cat /proc/net/unix']).toString().match(/webview_devtools_remote_\d+/)[0]
  execFileSync('adb', ['forward', 'tcp:9333', `localabstract:${sock}`])
  browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
  const pg = browser.contexts().flatMap(c => c.pages())[0]
  // Reset the phone vault from earlier runs: notes, plugins, sync state; then reload
  await pg.evaluate(async () => {
    const a = window.app.vault.adapter, d = window.app.vault.configDir
    for (const id of ['blax-sync', 'hello-test']) if (window.app.plugins.enabledPlugins.has(id)) await window.app.plugins.disablePluginAndSave(id)
    const root = await a.list('/')
    for (const f of root.files) await a.remove(f)
    for (const dir of root.folders) if (dir !== d) await a.rmdir(dir, true)
    if (await a.exists(d + '/plugins')) await a.rmdir(d + '/plugins', true)
    if (await a.exists(d + '/community-plugins.json')) await a.remove(d + '/community-plugins.json')
  })
  await pg.evaluate(() => window.app.commands.executeCommandById('app:reload'))
  await sleep(5000)
  await pg.waitForFunction(() => window.app?.workspace?.layoutReady, null, { timeout: 60000 })
  log('phone vault reset:', JSON.stringify(await pg.evaluate(async () => (await window.app.vault.adapter.list('/')))))
  await pg.evaluate(async ([main, manifest]) => {
    const a = window.app.vault.adapter, d = window.app.vault.configDir
    if (!(await a.exists(`${d}/plugins/blax-sync`))) await a.mkdir(`${d}/plugins/blax-sync`)
    await a.write(`${d}/plugins/blax-sync/main.js`, main)
    await a.write(`${d}/plugins/blax-sync/manifest.json`, manifest)
    await window.app.plugins.setEnable(true)
    await window.app.plugins.loadManifests()
    await window.app.plugins.enablePluginAndSave('blax-sync')
  }, [readFileSync(join(PLUGIN, 'main.js'), 'utf8'), readFileSync(join(PLUGIN, 'manifest.json'), 'utf8')])
  check('plugin loads on Android', await pg.evaluate(() => !!window.app.plugins.plugins['blax-sync']))

  // Wizard, same three steps as on desktop
  const modal = pg.locator('.modal-container .modal')
  await modal.waitFor({ timeout: 15000 })
  await pg.screenshot({ path: join(H, 'shots', 'android-1-wizard.png') })
  await modal.locator('button', { hasText: 'Next' }).click()
  const inputs = modal.locator('input')
  await inputs.nth(0).fill(URL_); await inputs.nth(1).fill('u'); await inputs.nth(2).fill('p'); await inputs.nth(3).fill(FOLDER)
  await modal.locator('button', { hasText: 'Test connection' }).click()
  await pg.waitForFunction(() => /[✓✗]/.test(document.querySelector('.blax-sync-status')?.textContent ?? ''), null, { timeout: 20000 })
  const status = await modal.locator('.blax-sync-status').textContent()
  check('connection test passes on Android', status.startsWith('✓'), status)
  await pg.screenshot({ path: join(H, 'shots', 'android-2-credentials.png') })
  await modal.locator('button', { hasText: 'Next' }).click()
  await modal.locator('button', { hasText: 'Finish and sync' }).click()
  const idle = () => pg.waitForFunction(() => { const p = window.app.plugins.plugins['blax-sync']; return p && !p.running && p.lastRun }, null, { timeout: 90000 })
  await idle()
  const syncPhone = async () => {
    await pg.waitForFunction(() => !window.app.plugins.plugins['blax-sync'].running, null, { timeout: 90000 })
    const before = await pg.evaluate(() => window.app.plugins.plugins['blax-sync'].lastRun?.at?.getTime() ?? 0)
    await pg.evaluate(() => window.app.plugins.plugins['blax-sync'].runSync())
    await pg.waitForFunction(b => { const p = window.app.plugins.plugins['blax-sync']; return !p.running && p.lastRun && p.lastRun.at.getTime() !== b }, before, { timeout: 90000 })
    const r = await pg.evaluate(() => window.app.plugins.plugins['blax-sync'].lastRun)
    log(`  phone sync: ${r.ok ? 'ok' : 'FAILED'} ${r.text}`)
    return r
  }
  const phoneRead = p => pg.evaluate(p => window.app.vault.adapter.exists(p).then(e => e ? window.app.vault.adapter.read(p) : null), p)
  const phoneWrite = (p, c) => pg.evaluate(([p, c]) => { const f = window.app.vault.getAbstractFileByPath(p); return f ? window.app.vault.modify(f, c) : window.app.vault.create(p, c) }, [p, c])
  log('  phone first sync:', JSON.stringify(await pg.evaluate(() => window.app.plugins.plugins['blax-sync'].lastRun)))

  check('phone got desktop notes', (await phoneRead('Notes/Hello.md')) === 'hello one')
  check('phone got umlaut note', (await phoneRead('Notes/Tagebuch Ä ö & co.md')) === '# Umlaute\n')
  check('phone got the synced plugin', !!(await phoneRead('.obsidian/plugins/hello-test/main.js')))
  check('phone flags the plugin change', await pg.evaluate(() => window.app.plugins.plugins['blax-sync'].lastResult?.configChanged === true))
  await pg.screenshot({ path: join(H, 'shots', 'android-3-after-sync.png') })

  // Phone -> desktop, same size
  await phoneWrite('Notes/Hello.md', 'hello from')
  await syncPhone(); desk()
  check('phone edit reaches desktop', deskRead('Notes/Hello.md') === 'hello from', JSON.stringify(deskRead('Notes/Hello.md')))
  // Desktop -> phone, same size: the phone's HTTP stack must not serve a cached copy
  deskWrite('Notes/Hello.md', 'hello desk'); desk()
  await syncPhone()
  check('same-size desktop edit reaches phone', (await phoneRead('Notes/Hello.md')) === 'hello desk', JSON.stringify(await phoneRead('Notes/Hello.md')))

  // Conflict
  deskWrite('Projects/Plan.md', 'plan from desktop'); desk()
  await phoneWrite('Projects/Plan.md', 'plan from phone, longer')
  await syncPhone()
  const files = await pg.evaluate(() => window.app.vault.getFiles().map(f => f.path))
  const conflict = files.find(p => p.startsWith('Projects/Plan.conflict-'))
  check('conflict keeps both versions on phone', !!conflict && (await phoneRead(conflict)) === 'plan from desktop' && (await phoneRead('Projects/Plan.md')) === 'plan from phone, longer', conflict)
  desk()
  check('conflict copy reaches desktop', !!conflict && deskRead(conflict) === 'plan from desktop')

  // Deletion on desktop goes to the phone's .trash
  execFileSync('mkdir', ['-p', join(DESK, '.trash')]); execFileSync('mv', [join(DESK, 'Notes/Tagebuch Ä ö & co.md'), join(DESK, '.trash/')])
  desk(); await syncPhone()
  check('desktop deletion moves the note to the phone trash', (await phoneRead('Notes/Tagebuch Ä ö & co.md')) === null && await pg.evaluate(() => window.app.vault.adapter.exists('.trash/Tagebuch Ä ö & co.md')))

  // Reload: the synced plugin runs on the phone
  await pg.evaluate(() => window.app.commands.executeCommandById('app:reload'))
  await sleep(5000)
  await pg.waitForFunction(() => window.app?.workspace?.layoutReady, null, { timeout: 60000 })
  await pg.waitForFunction(() => window.__helloTest === true, null, { timeout: 20000 }).then(() => check('synced plugin runs on phone after reload', true), () => check('synced plugin runs on phone after reload', false))
  await pg.screenshot({ path: join(H, 'shots', 'android-4-after-reload.png') })
  log('status bar:', await pg.evaluate(() => [...document.querySelectorAll('.status-bar-item')].map(e => e.textContent).find(t => t.includes('⇅')) ?? '(status bar hidden on mobile)'))
} catch (e) {
  log('ERROR', e.stack || e.message); results.push({ n: 'scenario finished', ok: false })
} finally {
  try { await browser?.close() } catch {}
  try { process.kill(-dav.pid, 'SIGKILL') } catch {}
  const failed = results.filter(r => !r.ok)
  log(`${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
