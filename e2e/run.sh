#!/usr/bin/env bash
# End-to-end runs against real Obsidian. See e2e/README.md.
#   e2e/run.sh            desktop; plus Android and the setup link when an emulator/phone is attached
# Needs: rclone, xvfb-run, obsidian (found on PATH, or via nix on NixOS), and for Android: adb with
# one device that has Obsidian installed and a vault open (the scripts reset that vault).
set -uo pipefail
cd "$(dirname "$0")/.."
find_bin() {   # name, nix attribute
  command -v "$1" 2>/dev/null && return
  command -v nix >/dev/null && nix build "nixpkgs#$2" --no-link --print-out-paths 2>/dev/null | grep -v -- '-man$' | head -1 | sed "s#\$#/bin/$1#"
}
export RCLONE_BIN=${RCLONE_BIN:-$(find_bin rclone rclone)}
export XVFB_RUN=${XVFB_RUN:-$(find_bin xvfb-run xvfb-run)}
export OBSIDIAN_BIN=${OBSIDIAN_BIN:-$(find_bin obsidian obsidian)}
export E2E_DIR=${E2E_DIR:-${TMPDIR:-/tmp}/blax-sync-e2e}
pnpm -s build || exit 1
rc=0
echo "== desktop (two Obsidian instances, Xvfb)"; node e2e/desktop.mjs | grep -E 'PASS|FAIL|ERROR|passed' || rc=1
if adb get-state >/dev/null 2>&1; then
  echo "== android"; node e2e/android.mjs | grep -E 'PASS|FAIL|ERROR|passed' || rc=1
  echo "== setup link (desktop QR -> phone)"; node e2e/setup-link.mjs | grep -E 'PASS|FAIL|ERROR|passed' || rc=1
else
  echo "== android and setup link skipped: no adb device"
fi
echo "screenshots: $E2E_DIR/shots"
exit $rc
