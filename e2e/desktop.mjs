// End-to-end: two real Obsidian instances (isolated profiles, Xvfb) sync through a local
// `rclone serve webdav --no-modtime`, set up through the plugin's own wizard.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, cpSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const REPO = new URL('..', import.meta.url).pathname
const H = process.env.E2E_DIR ?? join(tmpdir(), 'blax-sync-e2e')
mkdirSync(join(H, 'shots'), { recursive: true })
const RUN = join(H, 'run'); const SHOTS = join(H, 'shots')
const PLUGIN = process.env.PLUGIN_DIR ?? REPO
const RCLONE = process.env.RCLONE_BIN, XVFB = process.env.XVFB_RUN, OBSIDIAN = process.env.OBSIDIAN_BIN
const DAV_PORT = 18090
const procs = []
const log = (...a) => console.log('[e2e]', ...a)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); log(ok ? 'PASS' : 'FAIL', name, detail) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

rmSync(RUN, { recursive: true, force: true }); mkdirSync(SHOTS, { recursive: true }); mkdirSync(join(RUN, 'dav'), { recursive: true })

function vault(name, notes) {
  const dir = join(RUN, name)
  mkdirSync(join(dir, '.obsidian/plugins/blax-sync'), { recursive: true })
  for (const f of ['main.js', 'manifest.json']) cpSync(join(PLUGIN, f), join(dir, '.obsidian/plugins/blax-sync', f))
  writeFileSync(join(dir, '.obsidian/community-plugins.json'), '["blax-sync"]')
  for (const [p, c] of Object.entries(notes)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c) }
  return dir
}
function profile(name, vaultDir, id) {
  const ud = join(RUN, `profile-${name}`)
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'obsidian.json'), JSON.stringify({ vaults: { [id]: { path: vaultDir, ts: Date.now(), open: true } } }))
  return ud
}

async function launch(name, ud, port) {
  const env = { ...process.env }; for (const k of ['WAYLAND_DISPLAY', 'NIXOS_OZONE_WL', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE']) delete env[k]
  const p = spawn(XVFB, ['-a', '-s', '-screen 0 1280x900x24', OBSIDIAN, `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, '--disable-gpu', '--no-first-run'],
    { env, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
  p.stderr.on('data', () => {})
  procs.push(p)
  let browser
  for (let i = 0; i < 60 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`) } catch { await sleep(500) } }
  if (!browser) throw new Error(`${name}: no CDP`)
  let page
  for (let i = 0; i < 60 && !page; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(pg => pg.url().includes('index.html'))
    if (!page) await sleep(500)
  }
  if (!page) throw new Error(`${name}: no Obsidian window (${browser.contexts().flatMap(c => c.pages()).map(p => p.url())})`)
  await page.waitForFunction(() => window.app && window.app.workspace && window.app.workspace.layoutReady, null, { timeout: 30000 })
  return { name, browser, page }
}

async function trustIfAsked(o) {
  const btn = o.page.locator('button', { hasText: /Trust author/i })
  if (await btn.count()) { await btn.first().click(); log(o.name, 'trusted vault author'); await sleep(1500) }
  await o.page.waitForFunction(() => !!window.app.plugins.plugins['blax-sync'], null, { timeout: 20000 })
}

async function shot(o, label) { await o.page.screenshot({ path: join(SHOTS, `${o.name}-${label}.png`) }) }

async function wizard(o) {
  const modal = o.page.locator('.modal-container .modal')
  await modal.waitFor({ timeout: 15000 })
  await shot(o, '1-source')
  await modal.locator('button', { hasText: 'Next' }).click()
  const inputs = modal.locator('input')
  await inputs.nth(0).fill(`http://127.0.0.1:${DAV_PORT}`)
  await inputs.nth(1).fill('u')
  await inputs.nth(2).fill('p')
  await inputs.nth(3).fill('Shared Vault')
  const next = modal.locator('button', { hasText: 'Next' })
  check(`${o.name}: Next disabled before test`, await next.isDisabled())
  await modal.locator('button', { hasText: 'Test connection' }).click()
  await o.page.waitForFunction(() => /[✓✗]/.test(document.querySelector('.blax-sync-status')?.textContent ?? ''), null, { timeout: 15000 })
  const status = await modal.locator('.blax-sync-status').textContent()
  check(`${o.name}: connection test passes`, status.startsWith('✓'), status)
  await shot(o, '2-credentials')
  await next.click()
  await shot(o, '3-options')
  await modal.locator('button', { hasText: 'Finish and sync' }).click()
  await waitSync(o)
}

async function waitSync(o) {
  await o.page.waitForFunction(() => { const p = window.app.plugins.plugins['blax-sync']; return p && !p.running && p.lastRun }, null, { timeout: 60000 })
  return o.page.evaluate(() => window.app.plugins.plugins['blax-sync'].lastRun)
}
async function syncNow(o) {
  // Wait out any sync already running (timer or change-triggered), then run one and wait
  // for its own result.
  await o.page.waitForFunction(() => !window.app.plugins.plugins['blax-sync'].running, null, { timeout: 60000 })
  const before = await o.page.evaluate(() => window.app.plugins.plugins['blax-sync'].lastRun?.at?.getTime() ?? 0)
  await o.page.evaluate(() => window.app.plugins.plugins['blax-sync'].runSync())
  await o.page.waitForFunction(b => { const p = window.app.plugins.plugins['blax-sync']; return !p.running && p.lastRun && p.lastRun.at.getTime() !== b }, before, { timeout: 60000 })
  const r = await o.page.evaluate(() => window.app.plugins.plugins['blax-sync'].lastRun)
  log(`  ${o.name} sync: ${r.ok ? 'ok' : 'FAILED'} ${r.text}`)
  return r
}
const read = (o, p) => o.page.evaluate(p => window.app.vault.adapter.exists(p).then(e => e ? window.app.vault.adapter.read(p) : null), p)
const write = (o, p, c) => o.page.evaluate(([p, c]) => { const f = window.app.vault.getAbstractFileByPath(p); return f ? window.app.vault.modify(f, c) : window.app.vault.create(p, c) }, [p, c])
const statusBar = o => o.page.evaluate(() => [...document.querySelectorAll('.status-bar-item')].map(e => e.textContent).find(t => t.includes('⇅')))

try {
  const dav = spawn(RCLONE, ['serve', 'webdav', join(RUN, 'dav'), '--addr', `127.0.0.1:${DAV_PORT}`, '--user', 'u', '--pass', 'p', '--no-modtime'], { stdio: 'ignore', detached: true })
  procs.push(dav)
  const A_dir = vault('desktop', { 'Notes/Hello.md': 'hello one', 'Notes/Tagebuch Ä ö & co.md': '# Umlaute\n', 'Projects/Plan.md': 'plan' })
  const B_dir = vault('laptop', { 'Laptop note.md': 'from laptop' })
  const A = await launch('desktop', profile('desktop', A_dir, 'aaaaaaaaaaaaaaaa'), 9301)
  await trustIfAsked(A)
  await wizard(A)
  log('desktop first sync:', JSON.stringify(await A.page.evaluate(() => window.app.plugins.plugins['blax-sync'].lastRun)))
  check('server has the desktop notes', existsSync(join(RUN, 'dav/Shared Vault/Notes/Tagebuch Ä ö & co.md')))
  check('server has the manifest', existsSync(join(RUN, 'dav/Shared Vault/.blax-sync/manifest.json')))
  check('plugin code not synced', !existsSync(join(RUN, 'dav/Shared Vault/.obsidian/plugins/blax-sync/main.js')))
  check('plugin settings stay per device', !existsSync(join(RUN, 'dav/Shared Vault/.obsidian/plugins/blax-sync/data.json')))
  check('plugin state stays local', !existsSync(join(RUN, 'dav/Shared Vault/.obsidian/plugins/blax-sync/state.json')))
  log('status bar desktop:', await statusBar(A))
  await shot(A, '4-after-first-sync')

  const B = await launch('laptop', profile('laptop', B_dir, 'bbbbbbbbbbbbbbbb'), 9302)
  await trustIfAsked(B)
  await wizard(B)
  check('laptop got desktop notes', (await read(B, 'Notes/Hello.md')) === 'hello one')
  check('laptop got umlaut note', (await read(B, 'Notes/Tagebuch Ä ö & co.md')) === '# Umlaute\n')
  await syncNow(A)
  check('desktop got laptop note', (await read(A, 'Laptop note.md')) === 'from laptop')

  // Same-size edit
  const diag = o => o.page.evaluate(async () => { const p = window.app.plugins.plugins['blax-sync']; const st = await window.app.vault.adapter.stat('Notes/Hello.md'); return { stat: st, base: p.state.base['Notes/Hello.md'], disk: await window.app.vault.adapter.read('Notes/Hello.md') } })
  log('  before edit:', JSON.stringify(await diag(A)))
  await write(A, 'Notes/Hello.md', 'hello two')
  log('  after edit: ', JSON.stringify(await diag(A)))
  await syncNow(A); await syncNow(B)
  log('  server Hello.md:', JSON.stringify(readFileSync(join(RUN, 'dav/Shared Vault/Notes/Hello.md'), 'utf8')))
  check('same-size edit reaches laptop', (await read(B, 'Notes/Hello.md')) === 'hello two', JSON.stringify(await read(B, 'Notes/Hello.md')))

  // Conflict
  await write(A, 'Projects/Plan.md', 'plan from desktop')
  await write(B, 'Projects/Plan.md', 'plan from laptop, longer')
  await syncNow(A); await syncNow(B)
  const bFiles = await B.page.evaluate(() => window.app.vault.getFiles().map(f => f.path))
  const conflict = bFiles.find(p => p.startsWith('Projects/Plan.conflict-'))
  check('conflict keeps both versions on laptop', !!conflict && (await read(B, conflict)) === 'plan from desktop' && (await read(B, 'Projects/Plan.md')) === 'plan from laptop, longer', conflict)
  await shot(B, '5-conflict-notice')
  await syncNow(A)
  check('conflict copy reaches desktop', !!conflict && (await read(A, conflict)) === 'plan from desktop')

  // Plugin sync: install a small plugin on the desktop, it should arrive on the laptop
  await A.page.evaluate(async () => {
    const a = window.app.vault.adapter, d = window.app.vault.configDir
    await a.mkdir(`${d}/plugins/hello-test`)
    await a.write(`${d}/plugins/hello-test/manifest.json`, JSON.stringify({ id: 'hello-test', name: 'Hello test', version: '1.0.0', minAppVersion: '0.15.0', description: 'Test.', author: 'e2e' }))
    await a.write(`${d}/plugins/hello-test/main.js`, "const {Plugin}=require('obsidian');module.exports=class extends Plugin{onload(){window.__helloTest=true}}")
    await a.write(`${d}/community-plugins.json`, JSON.stringify(['blax-sync', 'hello-test']))
  })
  await syncNow(A); await syncNow(B)
  check('plugin files arrive on laptop', !!(await read(B, '.obsidian/plugins/hello-test/main.js')))
  // Notices don't render under Xvfb (Obsidian's own "Copied" notice doesn't either), so check the result flag the notice is shown for.
  check('laptop flags the plugin change for a reload', await B.page.evaluate(() => window.app.plugins.plugins['blax-sync'].lastResult?.configChanged === true))
  await shot(B, '6-reload-notice')
  await B.page.evaluate(() => window.app.commands.executeCommandById('app:reload'))
  await sleep(3000)
  await B.page.waitForFunction(() => window.app && window.app.workspace && window.app.workspace.layoutReady, null, { timeout: 30000 })
  await B.page.waitForFunction(() => window.__helloTest === true, null, { timeout: 15000 }).then(() => check('synced plugin runs on laptop after reload', true), () => check('synced plugin runs on laptop after reload', false))
  await waitSync(B)

  // Deletion goes to the trash on both sides
  await A.page.evaluate(() => window.app.vault.trash(window.app.vault.getAbstractFileByPath('Laptop note.md'), false))
  await syncNow(A)
  const trashDir = join(RUN, 'dav/Shared Vault/.blax-sync/trash')
  const trashed = existsSync(trashDir) ? execSync(`find "${trashDir}" -type f`).toString() : ''
  check('server moved deleted note to .blax-sync/trash', trashed.includes('Laptop note.md'))
  await syncNow(B)
  check('laptop moved deleted note to .trash', (await read(B, 'Laptop note.md')) === null && (await B.page.evaluate(() => window.app.vault.adapter.exists('.trash/Laptop note.md'))))
  log('status bar laptop:', await statusBar(B))
} catch (e) {
  log('ERROR', e.stack || e.message)
  results.push({ name: 'scenario finished', ok: false })
} finally {
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM') } catch {} }
  await sleep(1500)
  for (const p of procs) { try { process.kill(-p.pid, 'SIGKILL') } catch {} }
  const failed = results.filter(r => !r.ok)
  log(`${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
