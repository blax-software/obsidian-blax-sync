# End-to-end tests

Real Obsidian, real WebDAV server, no mocks: `e2e/run.sh`.

- `desktop.mjs`: two Obsidian desktop instances (isolated profiles, on an Xvfb display) sync through `rclone serve webdav --no-modtime`. Both go through the setup wizard; then a merge, a same-size edit, a conflict, plugin sync with a reload that loads the synced plugin, and deletions to the trash on both sides.
- `android.mjs`: Obsidian on an Android device or emulator, driven over its WebView's DevTools socket, against a simulated desktop (`desk-sim.ts`, the plugin's own engine on a folder). Covers the phone's file system and its native HTTP stack.
- `setup-link.mjs`: a desktop instance shows "Add another device"; the QR code is decoded from a screenshot and sent to the phone as a VIEW intent, the way a camera scan opens it; the phone asks for the code and syncs.

Requirements: `rclone`, `xvfb-run`, `obsidian` (on PATH, or found via nix), and `pnpm install` done. For the Android parts, `adb` with one device that runs Obsidian with a vault open: the scripts reset that vault. Screenshots land in `$E2E_DIR/shots` (default `/tmp/blax-sync-e2e`).

Two traps the scripts handle, in case you write more:

- An editor like VS Code exports `ELECTRON_RUN_AS_NODE=1`; Obsidian then starts as plain Node ("Cannot find module 'electron'"). The scripts unset it.
- Under Xvfb there is no window manager, and Obsidian's active window can drift to a hidden window; modals and notices opened later then attach there, invisible. A `focus` event on the main window puts it back.
