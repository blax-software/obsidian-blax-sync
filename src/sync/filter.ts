// Decides which vault paths take part in sync.

export const META_DIR = '.blax-sync'

export interface FilterOptions {
  configDir: string          // usually ".obsidian"
  syncConfig: boolean        // plugins and settings
  ignore: string[]           // user globs: "Private/**", "*.tmp"
  pluginId: string
}

const ALWAYS_IGNORED = [
  /^\.trash\//, /^\.git\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/,
  new RegExp(`^${META_DIR}/`),
  /^_remotely-save-metadata-on-remote\.json$/,
]

// Per-device UI state and caches inside the config dir never sync.
const CONFIG_IGNORED = [
  /^workspace(-mobile)?\.json$/, /^workspaces\.json$/, /(^|\/)cache(\/|$)/, /\/node_modules\//,
]

export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++ }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Folders a scan can skip entirely: nothing inside them can pass the file filter. */
export function makeDirFilter(o: FilterOptions): (dir: string) => boolean {
  const cfg = o.configDir.replace(/\/+$/, '')
  const userDirs = o.ignore.map(g => g.trim()).filter(g => g.endsWith('/**')).map(g => globToRegExp(g.slice(0, -3)))
  return (dir: string) => {
    if (['.trash', '.git', META_DIR].some(d => dir === d || dir.startsWith(d + '/'))) return true
    if (dir === cfg || dir.startsWith(cfg + '/')) {
      if (!o.syncConfig) return true
      const inner = dir.slice(cfg.length + 1)
      if (/(^|\/)(cache|node_modules)$/.test(inner)) return true
    }
    return userDirs.some(r => r.test(dir))
  }
}

export function makeFilter(o: FilterOptions): (path: string) => boolean {
  const user = o.ignore.map(g => g.trim()).filter(Boolean).map(globToRegExp)
  const cfg = o.configDir.replace(/\/+$/, '') + '/'
  // This plugin's own folder syncs only its settings: its state is per device, and copying
  // its code would make it update itself, which Obsidian's policies forbid.
  const ownDir = `plugins/${o.pluginId}/`
  const ownSettings = `${ownDir}data.json`
  return (path: string) => {
    if (ALWAYS_IGNORED.some(r => r.test(path))) return false
    if (user.some(r => r.test(path))) return false
    if (path.startsWith(cfg)) {
      if (!o.syncConfig) return false
      const inner = path.slice(cfg.length)
      if (inner.startsWith(ownDir) && inner !== ownSettings) return false
      if (CONFIG_IGNORED.some(r => r.test(inner))) return false
    }
    return true
  }
}
