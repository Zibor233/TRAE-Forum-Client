import path from 'node:path'

export function bundlePath(root, pathname) {
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const file = path.resolve(root, relative)
  const inside = path.relative(root, file)
  return inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? file : null
}

export function isAppUrl(value) {
  try { const url = new URL(value); return url.protocol === 'trae:' && url.host === 'app' } catch { return false }
}

export function externalUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
