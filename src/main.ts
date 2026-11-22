import { Notice, Platform, Plugin, normalizePath, type TAbstractFile } from 'obsidian'
import { BlaxSyncSettingTab, DEFAULT_SETTINGS, type BlaxSyncSettings } from './settings'
import { SetupWizard } from './wizard'
import { ObsidianFs } from './obsidian-fs'
import { obsidianRequest } from './request'
import { makeFilter } from './sync/filter'
import { DeletionGuardError, sync } from './sync/engine'
import { WebdavRemote } from './sync/webdav'
import type { LocalState, SyncResult } from './sync/types'

const CHANGE_DELAY_MS = 20_000

export default class BlaxSync extends Plugin {
  settings: BlaxSyncSettings = { ...DEFAULT_SETTINGS }
  private state: LocalState = { deviceId: '', base: {} }
  private running = false
  private queued = false
  private lastRun: { at: Date; ok: boolean; text: string } | null = null
  private statusEl: HTMLElement | null = null
  private timer: number | null = null
  private changeTimer: number | null = null
  private fs: ObsidianFs | null = null

  private get statePath() { return normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}/state.json`) }

  async onload() {
    await this.loadSettings()
    await this.loadState()
    this.statusEl = this.addStatusBarItem()
    this.renderStatus()
    this.addRibbonIcon('refresh-cw', 'Blax Sync: sync now', () => this.runSync())
    this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => this.runSync() })
    this.addCommand({ id: 'sync-allow-deletions', name: 'Sync now and allow large deletions', callback: () => this.runSync({ allowDeletions: true }) })
    this.addCommand({ id: 'setup', name: 'Run setup wizard', callback: () => this.openWizard() })
    this.addSettingTab(new BlaxSyncSettingTab(this.app, this))

    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.configured) this.openWizard()
      else window.setTimeout(() => this.runSync(), 3000)
      // Registered either way: onVaultChange ignores events until setup is done.
      const onChange = (f: TAbstractFile) => this.onVaultChange(f.path)
      this.registerEvent(this.app.vault.on('modify', onChange))
      this.registerEvent(this.app.vault.on('create', onChange))
      this.registerEvent(this.app.vault.on('delete', onChange))
      this.registerEvent(this.app.vault.on('rename', onChange))
    })
    this.reschedule()
  }

  onunload() {
    if (this.timer) window.clearInterval(this.timer)
    if (this.changeTimer) window.clearTimeout(this.changeTimer)
  }

  openWizard() { new SetupWizard(this.app, this).open() }

  async loadSettings() {
    const data = (await this.loadData()) ?? {}
    this.settings = { ...DEFAULT_SETTINGS, ...data, webdav: { ...DEFAULT_SETTINGS.webdav, ...(data.webdav ?? {}) } }
  }
  async saveSettings() { await this.saveData(this.settings) }

  // Device-local: never synced (filter excludes it), so each device keeps its own base.
  private async loadState() {
    try {
      if (await this.app.vault.adapter.exists(this.statePath)) {
        this.state = JSON.parse(await this.app.vault.adapter.read(this.statePath))
      }
    } catch { this.state = { deviceId: '', base: {} } }
    if (!this.state.deviceId) {
      const kind = Platform.isMobile ? 'mobile' : 'desktop'
      this.state.deviceId = `${kind}-${Math.random().toString(36).slice(2, 7)}`
      await this.saveState(this.state)
    }
  }
  private saveState = async (s: LocalState) => {
    await this.app.vault.adapter.write(this.statePath, JSON.stringify(s))
  }

  reschedule() {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = null
    const m = this.settings.intervalMinutes
    if (this.settings.configured && m > 0) this.timer = this.registerInterval(window.setInterval(() => this.runSync(), m * 60_000))
  }

  private onVaultChange(path: string) {
    if (!this.settings.syncOnChange || !this.settings.configured) return
    const wrote = this.fs?.recentWrites.get(path)
    if (wrote && Date.now() - wrote < 10_000) return   // our own download
    if (this.changeTimer) window.clearTimeout(this.changeTimer)
    this.changeTimer = window.setTimeout(() => this.runSync(), CHANGE_DELAY_MS)
  }

  statusText(): string {
    if (this.running) return 'Syncing …'
    if (!this.lastRun) return 'Not synced yet'
    const t = this.lastRun.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return this.lastRun.ok ? `Synced ${t}` : `Sync failed ${t}: ${this.lastRun.text}`
  }
  private renderStatus() {
    this.statusEl?.setText(this.settings.configured ? `⇅ ${this.statusText().split(':')[0]}` : '⇅ Blax Sync: not set up')
    if (this.statusEl) this.statusEl.title = this.statusText()
  }

  async runSync(opts: { allowDeletions?: boolean } = {}) {
    if (!this.settings.configured) { this.openWizard(); return }
    if (this.running) { this.queued = true; return }
    this.running = true
    this.renderStatus()
    const configDir = this.app.vault.configDir
    const filter = makeFilter({ configDir, syncConfig: this.settings.syncConfig, ignore: this.settings.ignore, pluginId: this.manifest.id })
    const skipDir = (dir: string) => !filter(`${dir}/\u0000probe`)   // don't descend into ignored trees
    this.fs = new ObsidianFs(this.app.vault.adapter, skipDir)
    try {
      const result = await sync({
        local: this.fs,
        remote: new WebdavRemote(this.settings.webdav, obsidianRequest),
        state: this.state,
        filter,
        configDir,
        allowDeletions: opts.allowDeletions,
        saveState: this.saveState,
      })
      this.report(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.lastRun = { at: new Date(), ok: false, text: msg }
      new Notice(e instanceof DeletionGuardError ? `Blax Sync: ${msg}` : `Blax Sync failed: ${msg}`, 10_000)
    } finally {
      this.running = false
      this.renderStatus()
      if (this.queued) { this.queued = false; window.setTimeout(() => this.runSync(), 1000) }
    }
  }

  private report(r: SyncResult) {
    const parts = [
      r.downloaded && `${r.downloaded} down`, r.uploaded && `${r.uploaded} up`,
      r.trashedLocal && `${r.trashedLocal} removed here`, r.trashedRemote && `${r.trashedRemote} removed on server`,
    ].filter(Boolean)
    this.lastRun = { at: new Date(), ok: r.errors.length === 0, text: r.errors[0] ?? (parts.join(', ') || 'up to date') }
    if (r.conflicts.length) new Notice(`Blax Sync: ${r.conflicts.length} conflict(s), both versions kept:\n${r.conflicts.slice(0, 5).join('\n')}`, 15_000)
    if (r.errors.length) new Notice(`Blax Sync: ${r.errors.length} file(s) failed, first: ${r.errors[0]}`, 10_000)
    if (r.configChanged) {
      const n = new Notice('Blax Sync: plugins or settings changed. Reload Obsidian to apply them. (Click to reload)', 0)
      n.noticeEl.addEventListener('click', () => (this.app as unknown as { commands: { executeCommandById(id: string): void } }).commands.executeCommandById('app:reload'))
    }
  }
}
