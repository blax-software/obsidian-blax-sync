// Obsidian's own settings files can't be resolved by keeping two copies: Obsidian only
// reads the original name. A conflict there is merged instead. The usual case is a new
// device whose fresh defaults meet the settings every other device already shares.

/** Lists (community-plugins.json) become the union, the shared order first. Objects merge
 * key by key with the server's (theirs) values winning, nested objects recursively.
 * Returns null when either side isn't JSON. */
export function mergeJson(mine: string, theirs: string): string | null {
  let a: unknown, b: unknown
  try { a = JSON.parse(mine); b = JSON.parse(theirs) } catch { return null }
  return JSON.stringify(merge(a, b), null, 2)
}

function merge(mine: unknown, theirs: unknown): unknown {
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const out: unknown[] = [...(theirs as unknown[])]
    for (const v of mine) if (!out.some(x => JSON.stringify(x) === JSON.stringify(v))) out.push(v)
    return out
  }
  if (isObject(mine) && isObject(theirs)) {
    const out: Record<string, unknown> = { ...mine }
    for (const [k, v] of Object.entries(theirs)) out[k] = k in mine ? merge(mine[k], v) : v
    return out
  }
  return theirs
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
