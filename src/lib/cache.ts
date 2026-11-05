/**
 * 本地持久化缓存（stale-while-revalidate）。
 * 只写入成功响应；读取时校验版本与 TTL，过期或损坏直接丢弃。
 * key 统一加版本前缀，升级缓存结构时改 VERSION 即可整体失效。
 */
const PREFIX = 'trae-lite.cache.v2.'
const VERSION = 2

interface Entry<T> {
  v: number
  at: number
  data: T
}

function storageKey(key: string) {
  return `${PREFIX}${key}`
}

export function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(storageKey(key))
    if (!raw) return null
    const entry = JSON.parse(raw) as Entry<T>
    if (!entry || entry.v !== VERSION) {
      localStorage.removeItem(storageKey(key))
      return null
    }
    if (!Number.isFinite(entry.at) || Date.now() - entry.at > ttlMs) return null
    return entry.data
  } catch {
    return null
  }
}

/** 读取时间戳（用于展示「缓存于几分钟前」或调试，不影响渲染） */
export function cacheAge(key: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(key))
    if (!raw) return null
    const entry = JSON.parse(raw) as Entry<unknown>
    return Number.isFinite(entry?.at) ? Date.now() - entry.at : null
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify({ v: VERSION, at: Date.now(), data }))
  } catch {
    // 本地存储不可用（配额/隐私模式）时只影响缓存，不影响功能
  }
}

export function removeCache(key: string): void {
  try {
    localStorage.removeItem(storageKey(key))
  } catch {
    // ignore
  }
}
