# Blax Sync for Obsidian

Sync your vault, and if you want, its plugins and settings, to your own WebDAV server. Setup is a three-step wizard: pick the storage, enter and test the credentials, decide whether plugins and settings come along. Then every device that runs the wizard against the same folder stays in sync.

## Why another sync plugin

- **Plugins and settings travel too.** Community plugins with their settings, themes, CSS snippets, hotkeys and appearance follow you to every device. A new device adopts the shared plugin list and settings instead of fighting over them. Workspace layout stays per device. After a sync that changed them, Obsidian offers a reload.
- **Second device in seconds.** Scan a QR code, type an 8-character code, done.
- **Edits are never missed.** Change detection uses content hashes kept in a manifest on the server (`.blax-sync/manifest.json`), not ETags or modification times. Some servers keep both through an edit that doesn't change the file size; `rclone serve webdav --no-modtime` is one.
- **Nothing is lost.** A file deleted on one device goes to Obsidian's `.trash` on the others, and to `.blax-sync/trash/<date>/` on the server. When two devices changed the same file, both versions are kept: yours under the original name, the other next to it as `name.conflict-<device>-<time>.md`. An edit always wins over a deletion. If one sync would remove more than a quarter of the files, it stops and asks.
- **Plain files on the server.** The server folder is a normal copy of your vault, readable by any tool, backup or search.

## Setup

1. Install the plugin (community store listing pending; until then via [BRAT](https://github.com/TfTHacker/obsidian42-brat) or by copying `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/blax-sync/`).
2. Enable it. The wizard opens: choose WebDAV, enter the server URL, username, password and the server folder, press "Test connection", then choose whether plugins and settings sync.
3. Repeat on every other device with the same folder.

**More devices without typing.** On a device that already syncs, open Settings → Blax Sync → "Add another device" (or the command of the same name). It shows a QR code and an 8-character code. On the new device, install Blax Sync, then scan the QR code with the camera (or paste the link into the wizard's "Use a setup link"), and enter the code. The link holds the connection settings encrypted with that code, so a forwarded link is useless without it.

The first sync merges: files that exist on one side are copied to the other, files that differ are kept twice. It never deletes.

Server URL examples: Nextcloud `https://<host>/remote.php/dav/files/<user>`, rclone `https://dav.example.com`, Synology `https://<nas>:5006`.

## When it syncs

On start, every 5 minutes (configurable, 0 = off), 20 seconds after you stop editing, and on demand: ribbon icon, command "Sync now", or the button in the settings. The status bar shows the last result.

## Network use

The plugin connects only to the WebDAV server you enter in the setup wizard, to list, read and write the files of your vault there. It sends no telemetry and contacts no other server. Your password is stored in the plugin's settings file inside your vault.

## Plugin sync and updates

With plugin sync on, the files of the community plugins you installed (and their settings) are copied between your own devices through your own server, the way your notes are. Blax Sync never downloads plugins from anywhere else, and it doesn't copy its own code: each device gets Blax Sync updates from Obsidian's community plugin browser.

## Good to know

- Credentials are stored in the plugin's `data.json` in your vault's config folder, like every other plugin's settings. Blax Sync's own folder never syncs: the server address can differ per device (LAN at home, public URL on the phone).
- Files edited on the server by other tools are picked up when their size changes or they are new. An outside edit that keeps the exact size is only noticed once the file changes again.
- Not synced: `.trash/`, `.git/`, the workspace layout, plugin caches, and Blax Sync's own folder. Add your own patterns under Settings → Ignore (`Private/**`, `*.tmp`).
- Mobile: works with Obsidian on Android and iOS. SFTP can't be reached from mobile plugins (HTTP only); put rclone in front of it (`rclone serve webdav`) to sync SFTP, S3, Google Drive and others through this plugin.

## Development

```sh
pnpm install
pnpm check                      # typecheck + tests
RCLONE_BIN=$(which rclone) pnpm test   # also runs the integration test against rclone serve webdav
pnpm build                      # main.js
```

The sync engine (`src/sync/`) has no Obsidian imports and runs against in-memory fakes in the tests. `src/main.ts`, `src/wizard.ts` and `src/obsidian-fs.ts` connect it to Obsidian.

## License

MIT, Blax Software & Consulting e.U.
