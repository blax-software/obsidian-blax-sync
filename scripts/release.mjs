// Cuts a release the way Obsidian's community directory reads it: the version in
// manifest.json (default branch HEAD) matches a GitHub release tag without a "v", and that
// release carries main.js and manifest.json as assets.
//
//   pnpm release 0.2.0        explicit version
//   pnpm release patch        or minor / major
//   pnpm release 0.1.0 --notes "First public version"
//
// Needs a clean tree on master, remotes `origin` (Forgejo) and `github`, and `gh` logged in.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const out = cmd => execSync(cmd).toString().trim()
const json = f => JSON.parse(readFileSync(f, 'utf8'))
const save = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + '\n')

const [arg, ...rest] = process.argv.slice(2)
const notesIdx = rest.indexOf('--notes')
const notesArg = notesIdx >= 0 ? rest[notesIdx + 1] : null
if (!arg) { console.error('usage: pnpm release <x.y.z|patch|minor|major> [--notes "…"]'); process.exit(64) }

if (out('git status --porcelain')) { console.error('release: working tree not clean'); process.exit(1) }
if (out('git rev-parse --abbrev-ref HEAD') !== 'master') { console.error('release: not on master'); process.exit(1) }
if (!out('git remote').split('\n').includes('github')) {
  console.error('release: add the GitHub remote first: git remote add github git@github.com:blax-software/obsidian-blax-sync.git')
  process.exit(1)
}

const manifest = json('manifest.json')
const [maj, min, pat] = manifest.version.split('.').map(Number)
const version = { major: `${maj + 1}.0.0`, minor: `${maj}.${min + 1}.0`, patch: `${maj}.${min}.${pat + 1}` }[arg] ?? arg
if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error(`release: "${version}" is not x.y.z`); process.exit(64) }
if (out('git tag --list').split('\n').includes(version)) { console.error(`release: tag ${version} exists`); process.exit(1) }

manifest.version = version
save('manifest.json', manifest)
const versions = json('versions.json'); versions[version] = manifest.minAppVersion; save('versions.json', versions)
const pkg = json('package.json'); pkg.version = version; save('package.json', pkg)

sh('pnpm check')
sh('pnpm build')

if (out('git status --porcelain')) sh(`git commit -qam "release: ${version}"`)
const last = out('git tag --list --sort=-v:refname').split('\n').filter(Boolean)[0]
const notes = notesArg ?? out(`git log --format="- %s" ${last ? `${last}..HEAD` : ''} --no-merges`).split('\n').filter(l => !l.startsWith('- release:')).join('\n')
sh(`git tag ${version}`)
sh(`git push -q origin master ${version}`)
sh(`git push -q github master ${version}`)
writeFileSync('.release-notes.md', notes || `Blax Sync ${version}`)
sh(`gh release create ${version} main.js manifest.json --repo blax-software/obsidian-blax-sync --title ${version} --notes-file .release-notes.md`)
sh('rm -f .release-notes.md')
console.log(`released ${version}`)
