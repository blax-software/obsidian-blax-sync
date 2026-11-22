# Releasing

Every release is `pnpm release <x.y.z|patch|minor|major>` (`scripts/release.mjs`). It bumps `manifest.json`, `versions.json` and `package.json`, runs `pnpm check` (typecheck, Obsidian's ESLint rules, tests), builds, tags without a `v`, pushes to Forgejo and GitHub and creates the GitHub release with `main.js` and `manifest.json` attached. Obsidian's community directory picks the new version up from that release on its own.

Before every release, run the end-to-end suites against real Obsidian on desktop and Android: `e2e/run.sh` (see `e2e/README.md`). It needs a running emulator for the Android parts; without one it runs desktop only.

## Getting into the community plugin browser (one time)

Submission works through the developer dashboard on community.obsidian.md (since 2026; no pull request to `obsidian-releases` any more). The directory only reads GitHub, and checks that the submitter owns the repo: for an organization repo, the submitter's membership in the org must be public (justsomexanda is a public admin of `blax-software`, checked 2026-11-22).

### Pre-release

- [x] (2026-11-22) GitHub repo `blax-software/obsidian-blax-sync` (public) and release 0.1.0 created, so BRAT can install it for device tests.
- [x] (2026-11-22) Device tests, automated: `e2e/run.sh` on Obsidian 1.15.1 desktop (two instances) and Android (emulator, official APK), 40 checks green, including the setup link from a desktop QR code to the phone.
- [ ] (2026-11-22) Switch `blax-software/obsidian-blax-sync` on Forgejo to public (repo settings; push-to-create made it private). **Owner:** Fabian (Forgejo UI). **Done when:** `curl -s -o /dev/null -w '%{http_code}' https://forgejo.blax.at/api/v1/repos/blax-software/obsidian-blax-sync` prints 200.

### Release

- [ ] (2026-11-22) Release the tested version: `pnpm release 0.2.0`. **Done when:** https://github.com/blax-software/obsidian-blax-sync/releases shows the version with `main.js` and `manifest.json`.
- [ ] (2026-11-22) Submit on https://community.obsidian.md: sign in with Fabian's Obsidian account, link the GitHub account `justsomexanda`, choose `blax-software/obsidian-blax-sync`, complete the dashboard steps. **Owner:** Fabian (submission needs his own Obsidian account). **Done when:** the automated review shows no errors (results come within minutes; use "Review branch" on the entry page to re-check a fix without a release).

### Post-release

- [ ] (2026-11-22) Check the listing. **Done when:** searching "Blax Sync" in Obsidian → Settings → Community plugins → Browse finds it (the directory says within 24 hours of a passing review).
- [ ] (2026-11-22) Move the real vault from Remotely Save to Blax Sync on every device (disable Remotely Save first, so two sync tools never run on one vault). **Owner:** Fabian.
