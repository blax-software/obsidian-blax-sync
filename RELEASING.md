# Releasing

Every release is `pnpm release <x.y.z|patch|minor|major>` (`scripts/release.mjs`). It bumps `manifest.json`, `versions.json` and `package.json`, runs `pnpm check` (typecheck, Obsidian's ESLint rules, tests), builds, tags without a `v`, pushes to Forgejo and GitHub and creates the GitHub release with `main.js` and `manifest.json` attached. Obsidian's community directory picks the new version up from that release on its own.

Before a release that touches the sync engine, run the integration test too: `RCLONE_BIN=$(which rclone) pnpm test`.

## Getting into the community plugin browser (one time)

Submission works through the developer dashboard on community.obsidian.md (since 2026; no pull request to `obsidian-releases` any more). The directory only reads GitHub, and checks that the submitter owns the repo: for an organization repo, the submitter's membership in the org must be public (justsomexanda is a public admin of `blax-software`, checked 2026-11-22).

### Pre-release

- [x] (2026-11-22) GitHub repo `blax-software/obsidian-blax-sync` (public) and release 0.1.0 created, so BRAT can install it for device tests.
- [ ] (2026-11-22) Test 0.1.0 on two real devices: the desktop test vault `~/Documents/Blax Sync Test` and Android via BRAT, against a separate server folder (e.g. `Blax Sync Test` on dav.blax.at). **Owner:** Fabian (needs the Obsidian app). **Done when:** a note edited on one device shows up on the other, a conflict leaves a `.conflict-` copy, and a plugin installed on one device arrives on the other after the reload prompt.
- [ ] (2026-11-22) Switch `blax-software/obsidian-blax-sync` on Forgejo to public (repo settings; push-to-create made it private). **Owner:** Fabian (Forgejo UI). **Done when:** `curl -s -o /dev/null -w '%{http_code}' https://forgejo.blax.at/api/v1/repos/blax-software/obsidian-blax-sync` prints 200.

### Release

- [ ] (2026-11-22) After the device test, fix what it found and release it: `pnpm release patch`. **Done when:** https://github.com/blax-software/obsidian-blax-sync/releases shows the version with `main.js` and `manifest.json`.
- [ ] (2026-11-22) Submit on https://community.obsidian.md: sign in with Fabian's Obsidian account, link the GitHub account `justsomexanda`, choose `blax-software/obsidian-blax-sync`, complete the dashboard steps. **Owner:** Fabian (submission needs his own Obsidian account). **Done when:** the automated review shows no errors (results come within minutes; use "Review branch" on the entry page to re-check a fix without a release).

### Post-release

- [ ] (2026-11-22) Check the listing. **Done when:** searching "Blax Sync" in Obsidian → Settings → Community plugins → Browse finds it (the directory says within 24 hours of a passing review).
- [ ] (2026-11-22) Move the real vault from Remotely Save to Blax Sync on every device (disable Remotely Save first, so two sync tools never run on one vault). **Owner:** Fabian.
