import { App, PluginSettingTab, Setting } from 'obsidian'
import type BlaxSync from './main'

export interface BlaxSyncSettings {
  configured: boolean
  backend: 'webdav'
  webdav: { url: string; username: string; password: string; folder: string }
  syncConfig: boolean
  intervalMinutes: number
  syncOnChange: boolean
  ignore: string[]
}

export const DEFAULT_SETTINGS: BlaxSyncSettings = {
  configured: false,
  backend: 'webdav',
  webdav: { url: '', username: '', password: '', folder: '' },
  syncConfig: true,
  intervalMinutes: 5,
  syncOnChange: true,
  ignore: [],
}

export class BlaxSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BlaxSync) { super(app, plugin) }

  display(): void {
    const { containerEl } = this
    const s = this.plugin.settings
    containerEl.empty()

    new Setting(containerEl)
      .setName('Status')
      .setDesc(s.configured ? `${this.plugin.statusText()} · WebDAV ${s.webdav.url} → ${s.webdav.folder}` : 'Not set up yet.')
      .addButton(b => b.setButtonText(s.configured ? 'Run setup again' : 'Set up').onClick(() => this.plugin.openWizard()))
      .addButton(b => b.setButtonText('Sync now').setCta().setDisabled(!s.configured).onClick(() => this.plugin.runSync()))

    new Setting(containerEl)
      .setName('Sync plugins and settings')
      .setDesc('Community plugins, their settings, themes, snippets, hotkeys and appearance. Workspace layout stays per device.')
      .addToggle(t => t.setValue(s.syncConfig).onChange(async v => { s.syncConfig = v; await this.plugin.saveSettings() }))

    new Setting(containerEl)
      .setName('Sync every … minutes')
      .setDesc('0 turns the timer off. A sync also runs on start.')
      .addText(t => t.setValue(String(s.intervalMinutes)).onChange(async v => {
        const n = Math.max(0, Math.floor(Number(v) || 0)); s.intervalMinutes = n
        await this.plugin.saveSettings(); this.plugin.reschedule()
      }))

    new Setting(containerEl)
      .setName('Sync after changes')
      .setDesc('Runs a sync 20 seconds after you stop editing.')
      .addToggle(t => t.setValue(s.syncOnChange).onChange(async v => { s.syncOnChange = v; await this.plugin.saveSettings() }))

    new Setting(containerEl)
      .setName('Ignore')
      .setDesc('One pattern per line, relative to the vault: Private/**, *.tmp')
      .addTextArea(t => t.setValue(s.ignore.join('\n')).onChange(async v => { s.ignore = v.split('\n'); await this.plugin.saveSettings() }))
  }
}
