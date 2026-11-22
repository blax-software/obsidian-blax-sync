// Setup link across devices: desktop Obsidian (Xvfb) shows "Add another device", the QR is
// decoded from a screenshot, the link goes to the Android emulator as a real VIEW intent,
// the phone asks only for the code and syncs.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'

const REPO = new URL('..', import.meta.url).pathname
const H = process.env.E2E_DIR ?? join(tmpdir(), 'blax-sync-e2e')
mkdirSync(join(H, 'shots'), { recursive: true })
const RUN = join(H, 'link-run'), PLUGIN = process.env.PLUGIN_DIR ?? REPO
const PORT = 18096, URL_ = `http://127.0.0.1:${PORT}`
const results = [], procs = []
const log = (...a) => console.log('[link]', ...a)
const check = (n, ok, d = '') => { results.push({ n, ok }); log(ok ? 'PASS' : 'FAIL', n, d) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
rmSync(RUN, { recursive: true, force: true }); mkdirSync(join(RUN, 'dav'), { recursive: true })

let desk, phone
try {
  procs.push(spawn(process.env.RCLONE_BIN, ['serve', 'webdav', join(RUN, 'dav'), '--addr', `127.0.0.1:${PORT}`, '--user', 'u', '--pass', 'p', '--no-modtime'], { stdio: 'ignore', detached: true }))
  execFileSync('adb', ['reverse', `tcp:${PORT}`, `tcp:${PORT}`])

  // Desktop vault + profile
  const V = join(RUN, 'desk'); mkdirSync(join(V, '.obsidian/plugins/blax-sync'), { recursive: true }); mkdirSync(join(V, 'Notes'))
  for (const f of ['main.js', 'manifest.json']) cpSync(join(PLUGIN, f), join(V, '.obsidian/plugins/blax-sync', f))
  writeFileSync(join(V, '.obsidian/community-plugins.json'), '["blax-sync"]')
  writeFileSync(join(V, 'Notes/From desktop.md'), 'written on the desktop')
  const UD = join(RUN, 'profile'); mkdirSync(UD); writeFileSync(join(UD, 'obsidian.json'), JSON.stringify({ vaults: { dddddddddddddddd: { path: V, ts: Date.now(), open: true } } }))
  const env = { ...process.env }; for (const k of ['WAYLAND_DISPLAY', 'NIXOS_OZONE_WL', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE']) delete env[k]
  procs.push(spawn(process.env.XVFB_RUN, ['-a', '-s', '-screen 0 1280x900x24', process.env.OBSIDIAN_BIN, `--user-data-dir=${UD}`, '--remote-debugging-port=9341', '--disable-gpu'], { env, stdio: 'ignore', detached: true }))
  for (let i = 0; i < 60 && !desk; i++) { try { desk = await chromium.connectOverCDP('http://127.0.0.1:9341') } catch { await sleep(500) } }
  let dp; for (let i = 0; i < 60 && !dp; i++) { dp = desk.contexts().flatMap(c => c.pages()).find(p => p.url().includes('index.html')); if (!dp) await sleep(500) }
  await dp.waitForFunction(() => window.app?.workspace?.layoutReady, null, { timeout: 30000 })
  const trust = dp.locator('button', { hasText: /Trust author/i }); if (await trust.count()) { await trust.first().click(); await sleep(1500) }
  await dp.waitForFunction(() => !!window.app.plugins.plugins['blax-sync'], null, { timeout: 20000 })

  // Desktop: normal wizard
  const dm = dp.locator('.modal-container .modal').last()
  await dm.waitFor({ timeout: 15000 })
  await dm.locator('button', { hasText: 'Next' }).click()
  const inp = dm.locator('input')
  await inp.nth(0).fill(URL_); await inp.nth(1).fill('u'); await inp.nth(2).fill('p'); await inp.nth(3).fill('Linked Vault')
  await dm.locator('button', { hasText: 'Test connection' }).click()
  await dp.waitForFunction(() => /✓/.test(document.querySelector('.blax-sync-status')?.textContent ?? ''), null, { timeout: 15000 })
  await dm.locator('button', { hasText: 'Next' }).click()
  await dm.locator('button', { hasText: 'Finish and sync' }).click()
  await dp.waitForFunction(() => { const p = window.app.plugins.plugins['blax-sync']; return !p.running && p.lastRun }, null, { timeout: 60000 })

  // Desktop: "Add another device"
  // Under Xvfb (no window manager) Obsidian's active window drifts to a hidden window, and
  // modals opened later attach there; a focus event on the main window puts it back.
  await dp.evaluate(() => { window.dispatchEvent(new FocusEvent('focus')) })
  await dp.evaluate(() => window.app.plugins.plugins['blax-sync'].openAddDevice())
  const am = dp.locator('.modal-container .modal').last()
  await am.locator('svg.blax-sync-qr').waitFor({ timeout: 10000 })
  const code = await am.locator('input').first().inputValue()
  const qrPng = join(H, 'shots', 'link-qr.png')
  await am.locator('svg.blax-sync-qr').screenshot({ path: qrPng })
  const png = PNG.sync.read(readFileSync(qrPng))
  const link = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data
  check('desktop shows a code and a scannable QR with the setup link', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code) && !!link?.startsWith('obsidian://blax-sync-setup?d='), `${code} ${link?.slice(0, 45)}…`)
  await am.locator('button', { hasText: 'Copy link' }).click()
  await sleep(500)
  const copied = await dp.evaluate(async () => { try { return await navigator.clipboard.readText() } catch (e) { return 'n/a: ' + e } })
  check('"Copy link" puts the same link on the clipboard', copied === link, copied?.slice(0, 45))
  await dp.screenshot({ path: join(H, 'shots', 'link-add-device.png') })

  // Phone: fresh vault with the plugin installed but not set up
  const sock = execFileSync('adb', ['shell', 'cat /proc/net/unix']).toString().match(/webview_devtools_remote_\d+/)[0]
  execFileSync('adb', ['forward', 'tcp:9333', `localabstract:${sock}`])
  phone = await chromium.connectOverCDP('http://127.0.0.1:9333')
  const pp = phone.contexts().flatMap(c => c.pages())[0]
  await pp.evaluate(async ([main, manifest]) => {
    const a = window.app.vault.adapter, d = window.app.vault.configDir
    for (const id of ['blax-sync', 'hello-test']) if (window.app.plugins.enabledPlugins.has(id)) await window.app.plugins.disablePluginAndSave(id)
    const root = await a.list('/')
    for (const f of root.files) await a.remove(f)
    for (const dir of root.folders) if (dir !== d) await a.rmdir(dir, true)
    if (await a.exists(d + '/plugins')) await a.rmdir(d + '/plugins', true)
    await a.mkdir(d + '/plugins/blax-sync')
    await a.write(d + '/plugins/blax-sync/main.js', main)
    await a.write(d + '/plugins/blax-sync/manifest.json', manifest)
    await window.app.plugins.loadManifests()
    await window.app.plugins.enablePluginAndSave('blax-sync')
  }, [readFileSync(join(PLUGIN, 'main.js'), 'utf8'), readFileSync(join(PLUGIN, 'manifest.json'), 'utf8')])
  await sleep(1500)
  check('wizard opens by itself on the fresh phone', await pp.locator('.modal-title', { hasText: 'Blax Sync setup' }).count() > 0)

  // What a camera scan does: a VIEW intent with the link
  execFileSync('adb', ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${link}'`, 'md.obsidian'])
  const jm = pp.locator('.modal-container .modal', { hasText: 'Set up from another device' })
  await jm.waitFor({ timeout: 20000 }).then(() => check('scanned link opens the code dialog on the phone', true), () => check('scanned link opens the code dialog on the phone', false))
  await pp.screenshot({ path: join(H, 'shots', 'link-phone-code.png') })
  await jm.locator('input').fill('wrong-code')
  await jm.locator('button', { hasText: 'Connect and sync' }).click()
  await pp.waitForFunction(() => /✗/.test(document.querySelector('.blax-sync-status')?.textContent ?? ''), null, { timeout: 15000 })
  check('a wrong code is refused', /match/.test(await jm.locator('.blax-sync-status').textContent()))
  await jm.locator('input').fill(code.toLowerCase())
  await jm.locator('button', { hasText: 'Connect and sync' }).click()
  await pp.waitForFunction(() => { const p = window.app.plugins.plugins['blax-sync']; return p.settings.configured && !p.running && p.lastRun }, null, { timeout: 60000 })
  const s = await pp.evaluate(() => ({ url: window.app.plugins.plugins['blax-sync'].settings.webdav.url, folder: window.app.plugins.plugins['blax-sync'].settings.webdav.folder, run: window.app.plugins.plugins['blax-sync'].lastRun }))
  check('phone set itself up from the link', s.url === URL_ && s.folder === 'Linked Vault', JSON.stringify(s))
  check('the wizard behind the code dialog is gone', await pp.locator('.modal-title', { hasText: 'Blax Sync setup' }).count() === 0)
  await pp.screenshot({ path: join(H, 'shots', 'link-phone-after.png') })
  check('phone synced the desktop note', (await pp.evaluate(() => window.app.vault.adapter.read('Notes/From desktop.md'))) === 'written on the desktop')
} catch (e) {
  log('ERROR', e.stack || e.message); results.push({ n: 'scenario finished', ok: false })
} finally {
  try { await phone?.close() } catch {}
  try { await desk?.close() } catch {}
  for (const p of procs) { try { process.kill(-p.pid, 'SIGKILL') } catch {} }
  const failed = results.filter(r => !r.ok)
  log(`${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
