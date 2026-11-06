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
let updateFetch = (...args) => fetch(...args)
export function configureUpdateTransport(transport) {
  updateFetch = transport
  expires = 0
}

export function releasesFromAtom(xml) {
  const releases = []
  for (const entry of xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) || []) {
    const link = entry.match(/<link[^>]*href=["']([^"']*\/releases\/tag\/[^"']+)["']/)?.[1]
    if (!link) continue
    try {
      const url = new URL(link)
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${repository}/releases/tag/`)) continue
      const tag = decodeURIComponent(url.pathname.split('/releases/tag/')[1])
      const version = parseVersion(tag)
      if (version) releases.push({ tag_name: tag, prerelease: version[3] !== 3, draft: false })
    } catch { /* Ignore malformed entries. */ }
  }
  if (!releases.length) throw new Error('更新列表暂不可用，请前往发布页查看')
  return releases
}

async function requestReleases() {
  try {
    const response = await updateFetch(`https://api.github.com/repos/${repository}/releases?per_page=20`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TRAE-Forum-Client' },
      credentials: 'omit', signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error('GitHub API unavailable')
    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('Invalid releases response')
    return data
  } catch {
    // github.com may be reachable even when api.github.com is blocked or rate-limited.
    const response = await updateFetch(`https://github.com/${repository}/releases.atom`, {
      headers: { Accept: 'application/atom+xml', 'User-Agent': 'TRAE-Forum-Client' },
      credentials: 'omit', signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error(`GitHub 更新源返回 HTTP ${response.status}，请稍后重试`)
    return releasesFromAtom(await response.text())
  }
}
export async function checkForUpdates(force = false) {
  if (!force && Date.now() < expires) return cached
  if (pending) return pending
  pending = (async () => {
    try {
      const data = await requestReleases()
      const latest = selectRelease(data, currentVersion)
      cached = latest ? { available: true, currentVersion, version: latest.tag_name, url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(latest.tag_name)}` } : { available: false, currentVersion }
      expires = Date.now() + 6 * 60 * 60_000
    } catch (error) {
      cached = { available: false, currentVersion, error: error.message?.startsWith('GitHub 更新源返回 HTTP') ? error.message : '检测更新失败：无法连接 GitHub 更新源，请检查系统代理后重试' }
      expires = Date.now() + 15 * 60_000
    }
    return cached
  })().finally(() => { pending = null })
  return pending
}
