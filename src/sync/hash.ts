// SHA-256 via WebCrypto: available in Obsidian on desktop and mobile, and in Node 22.
export async function hash(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}
