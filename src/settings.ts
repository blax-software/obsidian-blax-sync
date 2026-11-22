import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian'
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

  // Obsidian 1.13+: declarative settings, which also makes them findable in the settings
  // search. Older versions don't call this and render display() below instead.
  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings
    return [
      { name: 'Sync now', desc: s.configured ? `${this.plugin.statusText()} · ${s.webdav.url} → ${s.webdav.folder}` : 'Not set up yet.', aliases: ['status', 'webdav'], disabled: () => !this.plugin.settings.configured, action: () => { void this.plugin.runSync() } },
      { name: s.configured ? 'Run setup again' : 'Set up', desc: 'Storage, credentials, plugins: the three-step wizard.', aliases: ['wizard', 'server', 'password'], action: () => this.plugin.openWizard() },
      { name: 'Add another device', desc: 'Shows a QR code and a setup link with a one-time code, so the next device needs no typing.', aliases: ['qr', 'setup link', 'phone'], disabled: () => !this.plugin.settings.configured, action: () => this.plugin.openAddDevice() },
      { type: 'group', heading: 'Sync', items: [
        { name: 'Sync plugins and settings', desc: 'Community plugins, their settings, themes, snippets, hotkeys and appearance. Workspace layout stays per device.', control: { type: 'toggle', key: 'syncConfig' } },
        { name: 'Sync every … minutes', desc: '0 turns the timer off. A sync also runs on start.', control: { type: 'number', key: 'intervalMinutes', min: 0, step: 1 } },
        { name: 'Sync after changes', desc: 'Runs a sync 20 seconds after you stop editing.', control: { type: 'toggle', key: 'syncOnChange' } },
        { name: 'Ignore', desc: 'One pattern per line, relative to the vault: Private/**, *.tmp', control: { type: 'textarea', key: 'ignore', rows: 4 } },
      ] },
    ]
  }

  getControlValue(key: string): unknown {
    const v = (this.plugin.settings as unknown as Record<string, unknown>)[key]
    return key === 'ignore' && Array.isArray(v) ? v.join('\n') : v
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings
    if (key === 'syncConfig' || key === 'syncOnChange') s[key] = value === true
    else if (key === 'intervalMinutes') s.intervalMinutes = Math.max(0, Math.floor(Number(value) || 0))
    else if (key === 'ignore') s.ignore = (typeof value === 'string' ? value : '').split('\n')
    else return
    await this.plugin.saveSettings()
    if (key === 'intervalMinutes') this.plugin.reschedule()
  }

  display(): void {
    const { containerEl } = this
    const s = this.plugin.settings
    containerEl.empty()

    new Setting(containerEl)
      .setName('Status')
      .setDesc(s.configured ? `${this.plugin.statusText()} · WebDAV ${s.webdav.url} → ${s.webdav.folder}` : 'Not set up yet.')
      .addButton(b => b.setButtonText(s.configured ? 'Run setup again' : 'Set up').onClick(() => this.plugin.openWizard()))
      .addButton(b => b.setButtonText('Sync now').setCta().setDisabled(!s.configured).onClick(() => { void this.plugin.runSync() }))

    new Setting(containerEl)
      .setName('Add another device')
      .setDesc('Shows a QR code and a setup link with a one-time code, so the next device needs no typing.')
      .addButton(b => b.setButtonText('Show QR code').setDisabled(!s.configured).onClick(() => this.plugin.openAddDevice()))

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
