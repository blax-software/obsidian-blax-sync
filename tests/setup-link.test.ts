import { describe, expect, it } from 'vitest'
import { extractData, makeLink, newCode, normalizeCode, openLink, type SetupPayload } from '../src/setup-link'

const payload: SetupPayload = { v: 1, url: 'https://dav.example.com', username: 'me', password: 'pässwört', folder: 'My Vault', syncConfig: true }

describe('setup link', () => {
  it('round-trips with the right code, in any spelling', async () => {
    const code = newCode()
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    const link = await makeLink(payload, code)
    expect(link.startsWith('obsidian://blax-sync-setup?d=')).toBe(true)
    expect(link).not.toContain('pässwört')
    const d = extractData(`  ${link}  `)!
    expect(await openLink(d, code)).toEqual(payload)
    expect(await openLink(d, code.toLowerCase().replace('-', ' '))).toEqual(payload)
  })
  it('refuses a wrong code and damaged data', async () => {
    const link = await makeLink(payload, 'ABCD-EFGH')
    const d = extractData(link)!
    expect(await openLink(d, 'ABCD-EFGJ')).toBeNull()
    expect(await openLink(d.slice(0, -4) + 'AAAA', 'ABCD-EFGH')).toBeNull()
  })
  it('normalizes look-alike characters', () => {
    expect(normalizeCode('abcd efgh')).toBe('ABCDEFGH')
    expect(normalizeCode('0O1l-I')).toBe('00111')
  })
})
