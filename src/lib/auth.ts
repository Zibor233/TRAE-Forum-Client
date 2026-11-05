import JSEncrypt from 'jsencrypt'
import { fetchCurrentUser } from '../api'

const SESSION_STORAGE_KEY = 'trae-lite.user-api-key.v1'
const PENDING_STORAGE_KEY = 'trae-lite.user-api-key.pending.v1'
const CLIENT_ID_STORAGE_KEY = 'trae-lite.user-api-key.client-id.v1'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365

export const FORUM_ORIGIN = 'https://forum.trae.cn'
export const AUTH_SCOPES = 'read,write,message_bus,session_info'
export const APPLICATION_NAME = 'TRAE-Client'

export interface AuthSession {
  key: string
  username: string
  name?: string
  avatarTemplate?: string
  clientId: string
  nonce: string
  apiVersion?: number
  scopes: string
  createdAt: string
}

export interface PendingAuth {
  privateKey: string
  publicKey: string
  clientId: string
  nonce: string
  createdAt: string
}

function randomHex(bytes = 16): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthSession & { savedAt?: number }
    if (parsed.savedAt && Date.now() - parsed.savedAt > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_STORAGE_KEY)
      return null
    }
    if (!parsed.key || !parsed.username) return null
    return parsed
  } catch {
    return null
  }
}

/** 登录态变化事件：当前页面/弹层监听后自动重新请求，不需要手动刷新 */
export const AUTH_EVENT = 'trae-lite:auth-changed'

function notifyAuthChanged() {
  window.dispatchEvent(new Event(AUTH_EVENT))
}

export function saveSession(session: AuthSession) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...session, savedAt: Date.now() }))
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, session.clientId)
  notifyAuthChanged()
}

/** 复用已授权的 client_id，避免每次登录都在论坛「应用」里多出一条记录 */
function getOrCreateClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY)
  if (existing) return existing
  const next = crypto.randomUUID()
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, next)
  return next
}

export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY)
  sessionStorage.removeItem(PENDING_STORAGE_KEY)
  notifyAuthChanged()
}

export function loadPending(): PendingAuth | null {
  try {
    const raw = sessionStorage.getItem(PENDING_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PendingAuth) : null
  } catch {
    return null
  }
}

/** 生成 2048 位 RSA 密钥对（jsencrypt 使用 PKCS#1 v1.5，与论坛默认 padding 一致） */
export function createPendingAuth(): PendingAuth {
  const encryptor = new JSEncrypt({ default_key_size: '2048' })
  encryptor.getKey()
  const privateKey = encryptor.getPrivateKey()
  const publicKey = encryptor.getPublicKey()
  const pending: PendingAuth = {
    privateKey,
    publicKey,
    clientId: getOrCreateClientId(),
    nonce: randomHex(16),
    createdAt: new Date().toISOString(),
  }
  sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending))
  return pending
}

export function buildAuthUrl(pending: PendingAuth, authRedirect?: string): string {
  const params = new URLSearchParams({
    application_name: APPLICATION_NAME,
    client_id: pending.clientId,
    scopes: AUTH_SCOPES,
    nonce: pending.nonce,
    public_key: pending.publicKey,
  })
  if (authRedirect) params.set('auth_redirect', authRedirect)
  return `${FORUM_ORIGIN}/user-api-key/new?${params.toString()}`
}

/**
 * 解密授权页返回的 payload。
 * 论坛默认使用 PKCS#1 v1.5；payload 是 Base64 密文（可能带换行）。
 */
export function decryptPayload(payload: string, privateKey: string): {
  key: string
  nonce?: string
  api?: number | string
  push?: boolean
} {
  const clean = payload.replace(/\s+/g, '')
  if (!clean) throw new Error('payload 为空')
  const encryptor = new JSEncrypt()
  encryptor.setPrivateKey(privateKey)
  const plain = encryptor.decrypt(clean)
  if (!plain) throw new Error('payload 解密失败：密钥不匹配或内容不完整，请重新授权')
  let data: { key?: string; nonce?: string; api?: number | string; push?: boolean }
  try {
    data = JSON.parse(plain) as typeof data
  } catch {
    throw new Error('payload 解密后不是合法 JSON')
  }
  if (!data.key) throw new Error('payload 中缺少 key')
  return data as { key: string; nonce?: string; api?: number | string; push?: boolean }
}

export async function completeLogin(payload: string): Promise<AuthSession> {
  const pending = loadPending()
  if (!pending) throw new Error('本地登录会话已失效，请重新点击登录并打开授权页')
  const data = decryptPayload(payload, pending.privateKey)
  if (data.nonce && data.nonce !== pending.nonce) {
    throw new Error('nonce 不匹配：payload 不是本次授权产生的，请重新授权')
  }
  const user = await fetchCurrentUser(data.key)
  const session: AuthSession = {
    key: data.key,
    username: user.username,
    name: user.name,
    avatarTemplate: user.avatarTemplate,
    clientId: pending.clientId,
    nonce: pending.nonce,
    apiVersion: typeof data.api === 'number' ? data.api : undefined,
    scopes: AUTH_SCOPES,
    createdAt: new Date().toISOString(),
  }
  saveSession(session)
  sessionStorage.removeItem(PENDING_STORAGE_KEY)
  return session
}

/** 论坛回调地址若被白名单允许，payload 会出现在 ?payload= 或 #/auth/callback?payload= */
export function readPayloadFromLocation(): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get('payload')
  if (fromSearch) return fromSearch
  const hash = window.location.hash.replace(/^#/, '')
  const query = hash.split('?')[1]
  return query ? new URLSearchParams(query).get('payload') : null
}

export function revokeUrl(username: string): string {
  return `${FORUM_ORIGIN}/u/${encodeURIComponent(username)}/preferences/apps`
}

export function maskKey(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}
