// Setup link for another device: the connection settings, encrypted with a short code that
// is only shown on the device that made the link. The link alone (in a chat, a screenshot)
// reveals nothing. The code is 8 characters from a 32-letter alphabet (2^40 combinations),
// stretched with PBKDF2 (200k rounds), so guessing it offline is impractical.
//
// obsidian://blax-sync-setup?d=<base64url(salt 16 | iv 12 | AES-GCM ciphertext)>

export const PROTOCOL_ACTION = 'blax-sync-setup'

export interface SetupPayload {
  v: 1
  url: string
  username: string
  password: string
  folder: string
  syncConfig: boolean
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'   // no I, L, O, U: easy to read aloud and type
const ITERATIONS = 200_000

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const chars = [...bytes].map(b => ALPHABET[b % 32])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

/** Accepts the code in any case, with or without the dash or spaces. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

async function key(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const b64url = (bytes: Uint8Array) => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

export async function makeLink(payload: SetupPayload, code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(payload))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(code, salt), data))
  const all = new Uint8Array(salt.length + iv.length + sealed.length)
  all.set(salt); all.set(iv, salt.length); all.set(sealed, salt.length + iv.length)
  return `obsidian://${PROTOCOL_ACTION}?d=${b64url(all)}`
}

/** The `d` parameter from a full link, a bare value, or a link pasted with spaces around it. */
export function extractData(input: string): string | null {
  const t = input.trim()
  const m = t.match(/[?&]d=([A-Za-z0-9_-]+)/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{40,}$/.test(t) ? t : null
}

/** null when the code is wrong or the data is damaged. */
export async function openLink(d: string, code: string): Promise<SetupPayload | null> {
  try {
    const all = fromB64url(d)
    const salt = all.slice(0, 16), iv = all.slice(16, 28), sealed = all.slice(28)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(code, salt), sealed)
    const p = JSON.parse(new TextDecoder().decode(plain)) as SetupPayload
    return p && p.v === 1 && typeof p.url === 'string' ? p : null
  } catch {
    return null
  }
}
