# Blax Sync for Obsidian

Sync your vault, and if you want, its plugins and settings, to your own WebDAV server. Setup is a three-step wizard: pick the storage, enter and test the credentials, decide whether plugins and settings come along. Then every device that runs the wizard against the same folder stays in sync.

## Why another sync plugin

- **Plugins and settings travel too.** Community plugins with their settings, themes, CSS snippets, hotkeys and appearance follow you to every device. Workspace layout stays per device. After a sync that changed them, Obsidian offers a reload.
- **Edits are never missed.** Change detection uses content hashes kept in a manifest on the server (`.blax-sync/manifest.json`), not ETags or modification times. Some servers keep both through an edit that doesn't change the file size; `rclone serve webdav --no-modtime` is one.
- **Nothing is lost.** A file deleted on one device goes to Obsidian's `.trash` on the others, and to `.blax-sync/trash/<date>/` on the server. When two devices changed the same file, both versions are kept: yours under the original name, the other next to it as `name.conflict-<device>-<time>.md`. An edit always wins over a deletion. If one sync would remove more than a quarter of the files, it stops and asks.
- **Plain files on the server.** The server folder is a normal copy of your vault, readable by any tool, backup or search.

## Setup

1. Install the plugin (community store listing pending; until then via [BRAT](https://github.com/TfTHacker/obsidian42-brat) or by copying `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/blax-sync/`).
2. Enable it. The wizard opens: choose WebDAV, enter the server URL, username, password and the server folder, press "Test connection", then choose whether plugins and settings sync.
3. Repeat on every other device with the same folder.

The first sync merges: files that exist on one side are copied to the other, files that differ are kept twice. It never deletes.

Server URL examples: Nextcloud `https://<host>/remote.php/dav/files/<user>`, rclone `https://dav.example.com`, Synology `https://<nas>:5006`.

## When it syncs

On start, every 5 minutes (configurable, 0 = off), 20 seconds after you stop editing, and on demand: ribbon icon, command "Sync now", or the button in the settings. The status bar shows the last result.

## Good to know

- Credentials are stored in the plugin's `data.json` in your vault's config folder, like every other plugin's settings. With plugin sync on, that file reaches your other devices through your own server.
- Files edited on the server by other tools are picked up when their size changes or they are new. An outside edit that keeps the exact size is only noticed once the file changes again.
- Not synced: `.trash/`, `.git/`, the workspace layout, plugin caches, and this plugin's per-device state (`state.json`). Add your own patterns under Settings → Ignore (`Private/**`, `*.tmp`).
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
