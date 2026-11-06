// 本地代理：转发 /api/* 到 https://forum.trae.cn/*
// - 60 秒内存缓存（仅 GET），降低对官方论坛的压力
// - 读接口分桶令牌：主体 30 次/秒、突发 100；/t/{id}.json 与 /notifications.json 各 20 次/秒、突发 60；
//   /chat/* 10 次/秒、突发 30
// - 本机限流只做兜底：命中后先在代理内部排队等待（最多 5 秒），仍无配额才返回 429
// - 写接口固定窗口：20 次/分钟；429 统一 JSON + Retry-After
// - 透传客户端 UA（缺失时回退常见浏览器 UA）
// - 读请求只允许 GET/HEAD；写请求仅允许白名单路径，并将 User-Api-Key 透传上游
// - 密钥只存在于「浏览器 -> 本机代理 -> forum.trae.cn」，不会发往第三方

import http from 'node:http'
import { checkForUpdates } from '../desktop/updates.mjs'

const PORT = Number(process.env.PROXY_PORT || 8787)
const UPSTREAM = 'https://forum.trae.cn'
const CACHE_TTL_MS = 60_000
const CACHE_STALE_MS = 120_000
const CACHE_MAX_BYTES = 32 * 1024 * 1024
const pendingReads = new Map()
let cacheBytes = 0
let cacheGeneration = 0

function storeCache(key, entry) {
  const old = cache.get(key)
  if (old) cacheBytes -= old.body.length
  cache.delete(key)
  cache.set(key, entry)
  cacheBytes += entry.body.length
  for (const [oldKey, value] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break
    cache.delete(oldKey)
    cacheBytes -= value.body.length
  }
}

// 读接口：令牌桶（每秒补充 token，允许短时突发）
const READ_RATE_PER_SEC = 30
const READ_BURST = 100
// 话题详情与通知列表：各自独立桶
const TOPIC_READ_RATE_PER_SEC = 20
const TOPIC_READ_BURST = 60
const NOTIF_READ_RATE_PER_SEC = 20
const NOTIF_READ_BURST = 60
// 聊天接口：轮询/翻页较慢，单独限流避免抢占其他读请求
const CHAT_READ_RATE_PER_SEC = 10
const CHAT_READ_BURST = 30
// 本机限流命中后最多排队等待的时间
const LOCAL_QUEUE_MAX_WAIT_MS = 5_000

const TOPIC_READ_PATTERN = /^\/t\/\d+\.json/
const NOTIF_READ_PATTERN = /^\/notifications\.json/
const CHAT_READ_PATTERN = /^\/chat\//

// 写接口：固定窗口，保持严格
const WRITE_RATE_WINDOW_MS = 60_000
const WRITE_RATE_LIMIT = 20

const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const cache = new Map() // path -> { body: Buffer, status, contentType, expires }
const readBuckets = new Map() // `${ip}:${kind}` -> { tokens, at }
const writeHits = new Map() // ip -> { count, resetAt }

// 写操作白名单：点赞/取消赞、回复、发帖、图片上传、聊天消息
const WRITE_RULES = [
  { method: 'POST', pattern: /^\/bookmarks\.json$/ },
  { method: 'DELETE', pattern: /^\/bookmarks\/\d+\.json$/ },
  { method: 'PUT', pattern: /^\/notifications\/mark-read\.json$/ },
  { method: 'PUT', pattern: /^\/u\/[^/]+\.json$/ },
  { method: 'PUT', pattern: /^\/u\/[^/]+\/preferences\/(username|avatar\/pick)$/ },
  { method: 'PUT', pattern: /^\/u\/[^/]+\/(feature-topic|clear-featured-topic)$/ },
  { method: 'POST', pattern: /^\/(post_actions|post_actions\.json|posts|posts\.json)$/ },
  { method: 'POST', pattern: /^\/uploads\.json$/ },
  { method: 'POST', pattern: /^\/chat\/\d+$/ },
  { method: 'POST', pattern: /^\/chat\/api\/direct-message-channels$/ },
  { method: 'DELETE', pattern: /^\/post_actions\/\d+$/ },
  { method: 'PUT', pattern: /^\/chat\/api\/channels\/\d+\/messages\/\d+$/ },
  { method: 'DELETE', pattern: /^\/chat\/api\/channels\/\d+\/messages\/\d+$/ },
  { method: 'POST', pattern: /^\/chat\/api\/channels\/\d+\/messages\/\d+\/pin$/ },
  { method: 'DELETE', pattern: /^\/chat\/api\/channels\/\d+\/messages\/\d+\/pin$/ },
  { method: 'PUT', pattern: /^\/chat\/\d+\/\d+\/rebake$/ },
]

// 需要带 User-Api-Key 的读接口白名单：这些接口对匿名访问会 403/404，且不能走公共缓存
const AUTH_READ_RULES = [
  /^\/session\/current\.json/,
  /^\/notifications\.json/,
  // discourse-chat：频道列表、私信、消息分页（与账号相关，不能缓存）
  /^\/chat\//,
  /^\/u\/[^/]+\.json/,
  /^\/u\/[^/]+\/bookmarks\.json/,
  /^\/user_actions\.json/,
  /^\/topics\/created-by\//,
]

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'Accept, Content-Type, User-Api-Key, Api-Key, Api-Username',
  'access-control-max-age': '86400',
}

/**
 * 令牌桶：按 ip + 桶分别保存剩余 token。
 * 返回 null 表示放行；否则返回建议等待的秒数。
 */
function takeToken(map, key, ratePerSec, burst) {
  const now = Date.now()
  let bucket = map.get(key)
  if (!bucket) {
    bucket = { tokens: burst, at: now }
    map.set(key, bucket)
  }
  const elapsed = Math.max(0, now - bucket.at) / 1000
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * ratePerSec)
  bucket.at = now
  if (bucket.tokens < 1) {
    return Math.max(1, Math.ceil((1 - bucket.tokens) / ratePerSec))
  }
  bucket.tokens -= 1
  return null
}

/** 写接口固定窗口：返回 null 表示放行；否则返回建议等待的秒数 */
function takeWrite(ip) {
  const now = Date.now()
  let bucket = writeHits.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WRITE_RATE_WINDOW_MS }
    writeHits.set(ip, bucket)
  }
  bucket.count += 1
  if (bucket.count > WRITE_RATE_LIMIT) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }
  return null
}

/** 读接口按路径分桶：话题详情 / 通知 / 聊天各自独立，其余走主体桶 */
function readBucketFor(upstreamPath) {
  if (TOPIC_READ_PATTERN.test(upstreamPath)) {
    return { kind: 'topic', rate: TOPIC_READ_RATE_PER_SEC, burst: TOPIC_READ_BURST }
  }
  if (NOTIF_READ_PATTERN.test(upstreamPath)) {
    return { kind: 'notif', rate: NOTIF_READ_RATE_PER_SEC, burst: NOTIF_READ_BURST }
  }
  if (CHAT_READ_PATTERN.test(upstreamPath)) {
    return { kind: 'chat', rate: CHAT_READ_RATE_PER_SEC, burst: CHAT_READ_BURST }
  }
  return { kind: 'read', rate: READ_RATE_PER_SEC, burst: READ_BURST }
}

/**
 * 读接口取 token：本机限流只做兜底，命中后内部排队等待最多 5 秒；
 * 超时才返回建议等待秒数给前端（前端仍会静默重试，不会弹提示）。
 */
async function acquireReadToken(ip, upstreamPath) {
  const { kind, rate, burst } = readBucketFor(upstreamPath)
  const key = `${ip}:${kind}`
  const deadline = Date.now() + LOCAL_QUEUE_MAX_WAIT_MS
  for (;;) {
    const wait = takeToken(readBuckets, key, rate, burst)
    if (wait === null) return null
    const remaining = deadline - Date.now()
    if (remaining <= 0) return wait
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait * 1000, remaining)))
  }
}

/** 429 统一结构：{ error: 'rate_limited', scope, retryAfter } + Retry-After 头 */
function sendRateLimited(res, scope, retryAfter) {
  send(res, 429, JSON.stringify({ error: 'rate_limited', scope, retryAfter }), 'application/json; charset=utf-8', {
    'retry-after': String(retryAfter),
    'x-proxy-rate-scope': scope,
  })
}

function isAllowedWrite(method, path) {
  return WRITE_RULES.some((rule) => rule.method === method && rule.pattern.test(path))
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function pruneCache() {
  const now = Date.now()
  for (const [key, value] of cache) {
    if (value.expires + CACHE_STALE_MS < now) {
      cache.delete(key)
      cacheBytes -= value.body.length
    }
  }
}

function send(res, status, body, contentType, extra = {}) {
  res.writeHead(status, {
    'content-type': contentType || 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders,
    ...extra,
  })
  res.end(body)
}

async function handle(req, res) {
  const ip = req.socket.remoteAddress || 'unknown'
  const clientUrl = new URL(req.url || '/', 'http://localhost')
  if (clientUrl.pathname === '/api/client/update' && req.method === 'GET') {
    send(res, 200, JSON.stringify(await checkForUpdates(clientUrl.searchParams.get('force') === '1')))
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders)
    res.end()
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const url = new URL(req.url || '/', 'http://localhost')
    const upstreamPath = url.pathname.slice(4) + url.search
    if (!url.pathname.startsWith('/api/') || !isAllowedWrite(req.method, url.pathname.slice(4))) {
      send(res, 405, JSON.stringify({ error: '写操作未在白名单内' }))
      return
    }
    const writeWait = takeWrite(ip)
    if (writeWait !== null) {
      sendRateLimited(res, 'write', writeWait)
      return
    }
    await proxyWrite(req, res, upstreamPath, ip)
    return
  }

  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/')) {
    send(res, 404, JSON.stringify({ error: '仅支持 /api/*' }))
    return
  }

  const upstreamPath = url.pathname.slice(4) + url.search // 去掉 /api 前缀
  // 需要登录的读接口：透传 User-Api-Key，并且不缓存（内容与账号相关）
  const isAuthRead = AUTH_READ_RULES.some((rule) => rule.test(upstreamPath))
  // 带了 key 的任意读请求也按个性化处理：透传 key 且跳过缓存，
  // 这样私信话题（/t/{id}.json）能读到，同时匿名请求仍然走缓存。
  const userApiKey = req.headers['user-api-key']
  const personalized = Boolean(userApiKey) || isAuthRead
  const cacheKey = upstreamPath
  const cached = cache.get(cacheKey)
  if (!personalized && cached && cached.expires > Date.now()) {
    send(res, cached.status, cached.body, cached.contentType, { 'x-proxy-cache': 'HIT' })
    return
  }

  // 合并公共 GET 回源。鉴权响应绝不进入共享缓存或共享任务。
  const publicGet = !personalized && req.method === 'GET'
  const load = async () => {
    const started = Date.now()
    const generation = cacheGeneration
    const readWait = await acquireReadToken(ip, upstreamPath)
    if (readWait !== null) return {
      status: 429, body: JSON.stringify({ error: 'rate_limited', retryAfter: readWait }),
      contentType: 'application/json', extra: { 'retry-after': String(readWait) },
    }
    const upstream = await fetch(`${UPSTREAM}${upstreamPath}`, {
      method: req.method,
      redirect: 'follow',
      headers: {
        'user-agent': req.headers['user-agent'] || FALLBACK_UA,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
        referer: `${UPSTREAM}/`,
        ...(userApiKey ? { 'user-api-key': userApiKey } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8'
    const body = Buffer.from(await upstream.arrayBuffer())
    const upstreamCacheControl = upstream.headers.get('cache-control') || ''
    if (publicGet && upstream.status === 200 && contentType.includes('application/json') &&
        !/no-store|private|no-cache/i.test(upstreamCacheControl) &&
        !upstream.headers.has('set-cookie') && body.length < 8 * 1024 * 1024 && generation === cacheGeneration) {
      pruneCache()
      storeCache(cacheKey, { body, status: 200, contentType, expires: Date.now() + CACHE_TTL_MS,
        allowStale: !/must-revalidate|proxy-revalidate/i.test(upstreamCacheControl) })
    }
    const extra = {
      'x-proxy-cache': 'MISS',
      'x-proxy-upstream-status': String(upstream.status),
      'x-proxy-time': `${Date.now() - started}ms`,
    }
    if (upstream.status === 429) extra['retry-after'] = upstream.headers.get('retry-after') || '30'
    return { status: upstream.status, body, contentType, extra }
  }
  const pendingKey = `${cacheGeneration}:${cacheKey}`
  let pending = publicGet ? pendingReads.get(pendingKey) : null
  if (!pending) {
    pending = load().catch((err) => ({
      status: 502, body: JSON.stringify({ error: `上游请求失败：${err.message}` }),
      contentType: 'application/json', extra: {},
    })).finally(() => { if (publicGet) pendingReads.delete(pendingKey) })
    if (publicGet) pendingReads.set(pendingKey, pending)
  }
  // 允许短暂旧数据时立即返回，后台只有一个刷新任务。
  if (publicGet && cached?.allowStale && cached.expires + CACHE_STALE_MS > Date.now()) {
    send(res, cached.status, cached.body, cached.contentType, { 'x-proxy-cache': 'STALE' })
    return
  }
  const result = await pending
  send(res, result.status, result.body, result.contentType, result.extra)
}

async function proxyWrite(req, res, upstreamPath, ip) {
  const ua = req.headers['user-agent'] || FALLBACK_UA
  const apiKey = req.headers['user-api-key']
  if (!apiKey) {
    send(res, 401, JSON.stringify({ error: '缺少 User-Api-Key，请先登录' }))
    return
  }

  const started = Date.now()
  try {
    const body = await readBody(req, 20 * 1024 * 1024)
    const upstream = await fetch(`${UPSTREAM}${upstreamPath}`, {
      method: req.method,
      redirect: 'manual',
      headers: {
        'user-agent': ua,
        accept: 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9',
        referer: `${UPSTREAM}/`,
        'content-type': req.headers['content-type'] || 'application/json',
        'user-api-key': apiKey,
        ...(req.headers['api-key'] ? { 'api-key': req.headers['api-key'] } : {}),
        ...(req.headers['api-username'] ? { 'api-username': req.headers['api-username'] } : {}),
      },
      body: body.length ? body : undefined,
      signal: AbortSignal.timeout(20_000),
    })

    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8'
    const responseBody = Buffer.from(await upstream.arrayBuffer())
    if (upstream.ok) {
      cacheGeneration += 1
      cache.clear()
      cacheBytes = 0
    }
    console.log(`[proxy] ${req.method} ${upstreamPath} -> ${upstream.status} (${Date.now() - started}ms, ${ip})`)

    const extra = {
      'x-proxy-write': 'PASS',
      'x-proxy-upstream-status': String(upstream.status),
      'x-proxy-time': `${Date.now() - started}ms`,
    }
    if (upstream.status === 429) {
      extra['retry-after'] = upstream.headers.get('retry-after') || '30'
    }
    send(res, upstream.status, responseBody, contentType, extra)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    send(res, 502, JSON.stringify({ error: `上游请求失败：${message}` }))
  }
}

export function startProxy(port = PORT, { accessToken } = {}) {
  const server = http.createServer((req, res) => {
    if (accessToken && req.headers['x-desktop-token'] !== accessToken) {
      send(res, 403, JSON.stringify({ error: 'Forbidden' }))
      return
    }
    handle(req, res).catch((err) => {
      send(res, 500, JSON.stringify({ error: String(err) }))
    })
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`[proxy] http://127.0.0.1:${port}/api/  ->  ${UPSTREAM}`)
  })
  return server
}

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('proxy/server.mjs')
if (isDirectRun) startProxy()
