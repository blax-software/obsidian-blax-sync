// "Add another device" (shows QR, link and code) and "join with a setup link" (asks for
// the code, tests the connection, applies the settings, runs the first sync).

import { App, Modal, Notice, Setting } from 'obsidian'
import qrcode from 'qrcode-generator'
import type BlaxSync from './main'
import { extractData, makeLink, newCode, openLink, type SetupPayload } from './setup-link'
import { WebdavRemote } from './sync/webdav'
import { obsidianRequest } from './request'

function qrSvg(parent: HTMLElement, text: string) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount(), margin = 3, size = n + margin * 2
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin},${r + margin}h1v1h-1z`
  // Black on white regardless of theme: cameras need the contrast.
  const svg = parent.createSvg('svg', { attr: { viewBox: `0 0 ${size} ${size}`, width: '260', height: '260', 'shape-rendering': 'crispEdges' }, cls: 'blax-sync-qr' })
  svg.createSvg('rect', { attr: { width: String(size), height: String(size), fill: '#fff' } })
  svg.createSvg('path', { attr: { d, fill: '#000' } })
}

export class AddDeviceModal extends Modal {
  constructor(app: App, private plugin: BlaxSync) { super(app) }

  onOpen() { void this.render() }
  onClose() { this.contentEl.empty() }

  private async render() {
    const s = this.plugin.settings
    const el = this.contentEl
    this.titleEl.setText('Add another device')
    const code = newCode()
    const payload: SetupPayload = { v: 1, url: s.webdav.url, username: s.webdav.username, password: s.webdav.password, folder: s.webdav.folder, syncConfig: s.syncConfig }
    const link = await makeLink(payload, code)
    el.createEl('p', { text: 'On the new device, install Blax Sync from the community plugins first. Then scan this code with the camera, or copy the link there and paste it into the setup.' })
    qrSvg(el.createDiv({ cls: 'blax-sync-qr-wrap' }), link)
    new Setting(el)
      .setName('Code')
      .setDesc('The new device asks for it. It is only shown here, so the link alone is useless to anyone else.')
      .addText(t => { t.setValue(code); t.inputEl.readOnly = true })
    new Setting(el)
      .addButton(b => b.setButtonText('Copy link').onClick(async () => { await navigator.clipboard.writeText(link); new Notice('Setup link copied.') }))
      .addButton(b => b.setButtonText('Done').setCta().onClick(() => this.close()))
  }
}

export class JoinModal extends Modal {
  private data: string | null

  constructor(app: App, private plugin: BlaxSync, data: string | null) {
    super(app)
    this.data = data
  }

  onOpen() { this.render() }
  onClose() { this.contentEl.empty() }

  private render() {
    const el = this.contentEl
    el.empty()
    this.titleEl.setText('Set up from another device')
    let link = '', code = ''
    if (!this.data) {
      new Setting(el).setName('Setup link').setDesc('From "Add another device" on a device that already syncs.')
        .addText(t => t.setPlaceholder('obsidian://blax-sync-setup?d=…').onChange(v => { link = v }))
    }
    const codeRow = new Setting(el).setName('Code').setDesc('Shown next to the QR code on the other device.')
      .addText(t => { t.setPlaceholder('ABCD-1234').onChange(v => { code = v }); t.inputEl.autocapitalize = 'characters' })
    const status = el.createEl('p', { cls: 'blax-sync-status' })
    codeRow.addButton(b => b.setButtonText('Connect and sync').setCta().onClick(async () => {
      const d = this.data ?? extractData(link)
      if (!d) { status.setText('✗ That is not a Blax Sync setup link.'); return }
      status.setText('Checking …')
      const payload = await openLink(d, code)
      if (!payload) { status.setText('✗ The code doesn\'t match this link.'); return }
      const cfg = { url: payload.url, username: payload.username, password: payload.password, folder: payload.folder }
      const test = await new WebdavRemote(cfg, obsidianRequest).test()
      if (!test.ok) { status.setText(`✗ ${test.message}`); return }
      const s = this.plugin.settings
      s.backend = 'webdav'
      s.webdav = cfg
      s.syncConfig = payload.syncConfig
      s.configured = true
      await this.plugin.saveSettings()
      this.plugin.wizard?.close()
      this.close()
      new Notice('Blax Sync: connected, first sync started.')
      await this.plugin.runSync()
      this.plugin.reschedule()
    }))
  }
}
