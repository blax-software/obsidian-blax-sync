// Setup in three steps: where to (WebDAV for now), credentials (tested before you can go
// on), and whether plugins and settings sync too. Finishing runs the first sync, which
// only adds files on both sides and never removes anything.

import { App, Modal, Notice, Setting } from 'obsidian'
import type BlaxSync from './main'
import { WebdavRemote } from './sync/webdav'
import { obsidianRequest } from './request'

type Step = 1 | 2 | 3

export class SetupWizard extends Modal {
  private step: Step = 1
  private draft
  private tested = false
  private testMessage = ''

  constructor(app: App, private plugin: BlaxSync) {
    super(app)
    const s = plugin.settings
    this.draft = {
      backend: s.backend,
      webdav: { ...s.webdav, folder: s.webdav.folder || app.vault.getName() },
      syncConfig: s.syncConfig,
    }
  }

  onOpen() { this.render() }
  onClose() { this.contentEl.empty() }

  private render() {
    const el = this.contentEl
    el.empty()
    this.titleEl.setText(`Blax Sync setup · step ${this.step} of 3`)
    if (this.step === 1) this.source(el)
    if (this.step === 2) this.credentials(el)
    if (this.step === 3) this.options(el)
  }

  private nav(el: HTMLElement, opts: { back?: boolean; next: string; disabled?: boolean; onNext: () => void }) {
    const row = new Setting(el)
    if (opts.back) row.addButton(b => b.setButtonText('Back').onClick(() => { this.step = (this.step - 1) as Step; this.render() }))
    row.addButton(b => b.setButtonText(opts.next).setCta().setDisabled(!!opts.disabled).onClick(opts.onNext))
  }

  private source(el: HTMLElement) {
    el.createEl('p', { text: 'Where should this vault sync to?' })
    new Setting(el)
      .setName('Storage')
      .setDesc('WebDAV works with Nextcloud, ownCloud, rclone serve webdav, Synology, most NAS boxes and many hosters. More backends will follow.')
      .addDropdown(d => d.addOption('webdav', 'WebDAV').setValue('webdav').onChange(() => { this.draft.backend = 'webdav' }))
    this.nav(el, { next: 'Next', onNext: () => { this.step = 2; this.render() } })
  }

  private credentials(el: HTMLElement) {
    const w = this.draft.webdav
    const invalidate = () => { this.tested = false; this.testMessage = ''; status.setText('') ; next() }
    new Setting(el).setName('Server URL').setDesc('For Nextcloud: https://<host>/remote.php/dav/files/<user>')
      .addText(t => t.setPlaceholder('https://dav.example.com').setValue(w.url).onChange(v => { w.url = v.trim(); invalidate() }))
    new Setting(el).setName('Username')
      .addText(t => t.setValue(w.username).onChange(v => { w.username = v.trim(); invalidate() }))
    new Setting(el).setName('Password')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(w.password).onChange(v => { w.password = v; invalidate() }) })
    new Setting(el).setName('Folder on the server').setDesc('Created if it doesn\'t exist. Use the same folder on every device.')
      .addText(t => t.setValue(w.folder).onChange(v => { w.folder = v.trim().replace(/^\/+|\/+$/g, ''); invalidate() }))

    const status = el.createEl('p', { text: this.testMessage, cls: 'blax-sync-status' })
    const row = new Setting(el)
    row.addButton(b => b.setButtonText('Back').onClick(() => { this.step = 1; this.render() }))
    row.addButton(b => b.setButtonText('Test connection').onClick(async () => {
      if (!w.url || !w.username) { status.setText('URL and username are needed.'); return }
      status.setText('Testing …')
      const r = await new WebdavRemote(w, obsidianRequest).test()
      this.tested = r.ok
      this.testMessage = (r.ok ? '✓ ' : '✗ ') + r.message
      status.setText(this.testMessage)
      next()
    }))
    let nextBtn: HTMLButtonElement | null = null
    row.addButton(b => { nextBtn = b.buttonEl; b.setButtonText('Next').setCta().setDisabled(!this.tested).onClick(() => { this.step = 3; this.render() }) })
    const next = () => { if (nextBtn) nextBtn.disabled = !this.tested }
  }

  private options(el: HTMLElement) {
    new Setting(el)
      .setName('Sync plugins and settings too?')
      .setDesc('Community plugins with their settings, themes, snippets, hotkeys and appearance follow you to every device that uses this sync. Workspace layout stays per device.')
      .addToggle(t => t.setValue(this.draft.syncConfig).onChange(v => { this.draft.syncConfig = v }))
    el.createEl('p', { text: 'The first sync merges this vault with the server folder: files that exist on only one side are copied over, files that differ are kept twice (".conflict-…" copy). Nothing gets deleted.' })
    this.nav(el, {
      back: true, next: 'Finish and sync', onNext: () => { void this.finish() },
    })
  }

  private async finish() {
    const s = this.plugin.settings
    s.backend = this.draft.backend
    s.webdav = { ...this.draft.webdav }
    s.syncConfig = this.draft.syncConfig
    s.configured = true
    await this.plugin.saveSettings()
    this.close()
    new Notice('Blax Sync: first sync started.')
    await this.plugin.runSync()
    this.plugin.reschedule()
  }
}
