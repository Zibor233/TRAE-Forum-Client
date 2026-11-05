import { readFileSync } from 'node:fs'

export const repository = 'Zibor233/TRAE-Forum-Client'
export const currentVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
export function parseVersion(value) {
  const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)(?:-?(beta|alpha|rc)(?:[.-]?(\d+))?)?$/i)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? ({ alpha: 0, beta: 1, rc: 2 })[match[4].toLowerCase()] : 3, Number(match[5] || 1)]
}
export function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] > b[i] }
  return false
}
export function selectRelease(releases, current) {
  const allowPrerelease = parseVersion(current)?.[3] !== 3
  return releases.filter(release => !release.draft && (!release.prerelease || allowPrerelease) && isNewerVersion(release.tag_name, current))
    .sort((a, b) => isNewerVersion(a.tag_name, b.tag_name) ? -1 : 1)[0]
}

let cached = { available: false, currentVersion }
let expires = 0
let pending
export async function checkForUpdates() {
  if (Date.now() < expires) return cached
  if (pending) return pending
  pending = (async () => {
    try {
      const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=20`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TRAE-Forum-Client' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('Update check unavailable')
      const data = await response.json()
      if (!Array.isArray(data)) throw new Error('Invalid releases response')
      const latest = selectRelease(data, currentVersion)
      cached = latest ? { available: true, currentVersion, version: latest.tag_name, url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(latest.tag_name)}` } : { available: false, currentVersion }
      expires = Date.now() + 6 * 60 * 60_000
    } catch { expires = Date.now() + 15 * 60_000 }
    return cached
  })().finally(() => { pending = null })
  return pending
}
