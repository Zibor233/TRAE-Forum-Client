import { feedPath, type FeedOptions } from './lib/feed'
import type {
  BookmarkItem,
  Category,
  ChatChannel,
  ChatMessagesResponse,
  ChatOverview,
  EmojiGroup,
  EmojiItem,
  ForumUser,
  NotificationItem,
  Post,
  SearchResult,
  TagItem,
  TopicDetail,
  TopicList,
  UploadResult,
  UserActionItem,
  UserProfile,
} from './types'
import { dedupe, enqueue, type QueuePriority } from './lib/requestQueue'
import { readCache, writeCache, removeCache } from './lib/cache'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  errors: string[]
  /** 429 时本地代理或上游给出的建议等待秒数 */
  retryAfter?: number
  constructor(message: string, status: number, errors: string[] = [], retryAfter?: number) {
    super(message)
    this.status = status
    this.errors = errors
    this.retryAfter = retryAfter
  }
}

function formatError(status: number, detail: string) {
  // 面向用户只保留一句中性结论；状态码、限流等实现细节不再透出到界面
  if (detail) return detail
  if (status === 404) return '内容不存在或已被删除'
  if (status === 401 || status === 403) return '没有权限或密钥已失效'
  return '暂时无法加载'
}

function retryAfterFromHeaders(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds)
  const date = Date.parse(raw)
  if (Number.isFinite(date)) {
    return Math.max(1, Math.ceil((date - Date.now()) / 1000))
  }
  return undefined
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = ''
    let errors: string[] = []
    let retryAfter = retryAfterFromHeaders(res)
    try {
      const body = (await res.json()) as {
        error?: string
        errors?: string[]
        message?: string
        retryAfter?: number
      }
      errors = Array.isArray(body.errors) ? body.errors : []
      detail = body.error || body.message || errors.join('；') || ''
      if (!retryAfter && typeof body.retryAfter === 'number') {
        retryAfter = Math.round(body.retryAfter)
      }
    } catch {
      // ignore
    }
    throw new ApiError(formatError(res.status, detail), res.status, errors, retryAfter)
  }
  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

/**
 * 所有 GET 统一走全局队列（并发 4、按优先级出队）与 300ms 同 URL 合并，
 * 避免首屏大量作者补全请求把本地代理打爆。
 * 读失败静默重试：300ms → 1s → 2.5s（带抖动），不向 UI 暴露限流信息。
 */
function requestJSON<T>(
  path: string,
  apiKey?: string,
  signal?: AbortSignal,
  priority: QueuePriority = 'normal',
  retries: number = READ_RETRY_DELAYS.length,
): Promise<T> {
  // 聊天与个人主页的排队、冷却、网络和重试共用 25 秒等待上限。
  const boundedRead = /^\/(chat\/|u\/|user_actions\.json|topics\/created-by\/)/.test(path)
  const callerSignal = signal
  const controller = new AbortController()
  const abort = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) abort()
  else callerSignal?.addEventListener('abort', abort, { once: true })
  const timeout = boundedRead ? setTimeout(() => controller.abort(new DOMException('加载超时，请重试', 'TimeoutError')), 25_000) : undefined
  signal = boundedRead ? controller.signal : callerSignal
  const key = `${apiKey || 'anon'}:GET:${path}`
  const attempt = async () => {
    // 冷却期间不占用网络槽位；切页可以立即取消等待。
    await waitForRetry(cooldownLeft(path), signal)
    const run = () => enqueue(async () => {
      signal?.throwIfAborted()
      const res = await fetch(`${BASE}${path}`, {
        signal,
        headers: apiKey
          ? { accept: 'application/json', 'user-api-key': apiKey }
          : { accept: 'application/json' },
      })
      try {
        return await parseResponse<T>(res)
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          cooldowns.set(path, Date.now() + (err.retryAfter || 5) * 1000)
        }
        throw err
      }
    }, priority)
    // 独立取消生命周期不共享 fetch，公共回源由代理合并。
    return signal ? run() : dedupe(key, run)
  }
  const operation = withReadRetry(attempt, signal, retries)
  if (!boundedRead) {
    callerSignal?.removeEventListener('abort', abort)
    return operation
  }
  let rejectAbort: () => void
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason)
    if (controller.signal.aborted) rejectAbort()
    else controller.signal.addEventListener('abort', rejectAbort, { once: true })
  })
  return Promise.race([operation, cancelled]).finally(() => {
    clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', rejectAbort)
  })
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

const READ_RETRY_DELAYS = [300, 1000, 2500]

/** 论坛真实限流的路径级冷却：命中 429 后这段时间内不再重复请求，避免把惩罚窗口拖长 */
const cooldowns = new Map<string, number>()

function cooldownLeft(path: string) {
  const until = cooldowns.get(path)
  if (!until) return 0
  const left = until - Date.now()
  if (left <= 0) {
    cooldowns.delete(path)
    return 0
  }
  return left
}

function isRetryableRead(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500
  // 网络层错误（TypeError 等）同样静默重试
  return true
}

async function withReadRetry<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
  maxRetries: number = READ_RETRY_DELAYS.length,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await run()
    } catch (err) {
      if (signal?.aborted || !isRetryableRead(err)) throw err
      const apiError = err instanceof ApiError ? err : null
      // 论坛真实 429 带 Retry-After：按官方给出的等待时间退避一次（最多 45 秒）
      if (apiError?.status === 429 && apiError.retryAfter && attempt < 1) {
        attempt += 1
        const wait = Math.min(apiError.retryAfter * 1000, 45_000) + Math.floor(Math.random() * 500)
        await waitForRetry(wait, signal)
        continue
      }
      if (attempt >= maxRetries) throw err
      const delay = READ_RETRY_DELAYS[attempt] + Math.floor(Math.random() * 250)
      attempt += 1
      await waitForRetry(delay, signal)
    }
  }
}

function getJSON<T>(
  path: string,
  signal?: AbortSignal,
  priority: QueuePriority = 'normal',
  retries?: number,
): Promise<T> {
  return requestJSON<T>(path, undefined, signal, priority, retries)
}

async function writeJSON<T>(
  path: string,
  method: 'POST' | 'DELETE' | 'PUT',
  apiKey: string,
  payload?: unknown,
): Promise<T> {
  return enqueue(async () => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-api-key': apiKey,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    return parseResponse<T>(res)
  }, 'user')
}

function getWithKey<T>(
  path: string,
  apiKey: string,
  signal?: AbortSignal,
  priority: QueuePriority = 'user',
  retries?: number,
): Promise<T> {
  return requestJSON<T>(path, apiKey, signal, priority, retries)
}

export type FeedTab = 'latest' | 'top' | 'category'

const FEED_CACHE_TTL_MS = 10 * 60_000

function topicListPath(tab: FeedTab, categoryId: number | null, page: number) {
  return tab === 'top'
    ? `/top.json?page=${page}`
    : tab === 'category' && categoryId
      ? `/latest.json?category=${categoryId}&page=${page}`
      : `/latest.json?page=${page}`
}

/** 首屏列表缓存：先本地渲染，再用网络结果替换 */
export function peekTopicList(
  tab: FeedTab,
  categoryId: number | null,
  page: number,
): TopicList | null {
  return readCache<TopicList>(`feed:${topicListPath(tab, categoryId, page)}`, FEED_CACHE_TTL_MS)
}

export function fetchTopicList(tab: FeedTab, categoryId: number | null, page: number, signal?: AbortSignal) {
  const path = topicListPath(tab, categoryId, page)
  return getJSON<{ topic_list: TopicList; users?: ForumUser[] }>(path, signal).then((data) => {
    const list = {
      ...data.topic_list,
      users: data.users?.length ? data.users : data.topic_list.users,
    }
    writeCache(`feed:${path}`, list)
    return list
  })
}

let categoriesPromise: Promise<Category[]> | null = null

/** 分类缓存：30 分钟，首屏先用缓存立即渲染再用网络结果替换 */
export function getCachedCategories(): Category[] | null {
  return readCache<Category[]>('categories', 30 * 60_000)
}

export function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  if (!categoriesPromise) {
    categoriesPromise = getJSON<{ category_list: { categories: Category[] } }>(
      '/categories.json',
      signal,
      'normal',
    )
      .then((data) => {
        const list = data.category_list.categories
        writeCache('categories', list)
        return list
      })
      .catch((err) => {
        categoriesPromise = null
        throw err
      })
  }
  return categoriesPromise
}

export function fetchFeedTopics(
  categoryId: number | null,
  page: number,
  opts: FeedOptions = {},
  signal?: AbortSignal,
  priority: QueuePriority = 'normal',
): Promise<TopicList> {
  const path = feedPath(categoryId, page, opts)
  return getJSON<{ topic_list: TopicList; users?: ForumUser[] }>(path, signal, priority).then((data) => {
    const list = { ...data.topic_list, users: data.users?.length ? data.users : data.topic_list.users }
    writeCache(`feed:${path}`, list)
    return list
  })
}
export function peekFeedTopics(categoryId: number | null, page: number, opts: FeedOptions = {}): TopicList | null {
  return readCache<TopicList>(`feed:${feedPath(categoryId, page, opts)}`, FEED_CACHE_TTL_MS)
}
export const fetchCategoryTopics = fetchFeedTopics
export const peekCategoryTopics = peekFeedTopics

export function fetchTags(signal?: AbortSignal) {
  return getJSON<{ tags: TagItem[] }>('/tags.json', signal, 'normal').then((data) => {
    const tags = data.tags || []
    writeCache('tags', tags)
    return tags
  })
}

export function getCachedTags(): TagItem[] | null {
  return readCache<TagItem[]>('tags', 30 * 60_000)
}

export function fetchTopic(id: number, page = 1, signal?: AbortSignal, apiKey?: string) {
  const path = `/t/${id}.json?page=${page}`
  return apiKey
    ? getWithKey<TopicDetail>(path, apiKey, signal, 'user')
    : getJSON<TopicDetail>(path, signal, 'user')
}

/**
 * 批量读取指定楼层（点赞通知摘要用）。
 * 匿名即可读，走代理 60s 缓存；按 topic 批量请求，避免每条通知各发一次。
 */
export function fetchTopicPostsByIds(topicId: number, postIds: number[], signal?: AbortSignal) {
  const query = postIds.map((id) => `post_ids[]=${id}`).join('&')
  return getJSON<{ post_stream?: { posts?: Post[] } }>(
    `/t/${topicId}/posts.json?${query}`,
    signal,
    'prefetch',
  )
}

/** 逐页拉取全部楼层，最多 300 楼，避免长贴拖垮页面；带 key 可读取私信话题 */
export async function fetchTopicWithPosts(
  id: number,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<TopicDetail> {
  const first = await fetchTopic(id, 1, signal, apiKey)
  const posts = [...first.post_stream.posts]
  const limit = Math.min(Math.max(first.posts_count, posts.length), 300)
  let page = 2
  while (posts.length < limit && page <= 15) {
    if (signal?.aborted) break
    try {
      const next = await fetchTopic(id, page, signal, apiKey)
      const fresh = next.post_stream.posts.filter(
        (p) => !posts.some((existing) => existing.id === p.id),
      )
      if (!fresh.length) break
      posts.push(...fresh)
      page += 1
    } catch {
      break
    }
  }
  return { ...first, post_stream: { ...first.post_stream, posts } }
}

export function searchForum(q: string, signal?: AbortSignal) {
  return getJSON<SearchResult>(`/search.json?q=${encodeURIComponent(q)}`, signal, 'user')
}

/** 登录后读取当前用户：代理对 /session/current.json 单独放行 User-Api-Key，且不缓存 */
export async function fetchCurrentUser(apiKey: string) {
  return enqueue(async () => {
    const res = await fetch(`${BASE}/session/current.json`, {
      headers: { accept: 'application/json', 'user-api-key': apiKey },
    })
    if (!res.ok) {
      throw new ApiError(
        formatError(res.status, '密钥校验失败'),
        res.status,
        [],
        retryAfterFromHeaders(res),
      )
    }
    const data = (await res.json()) as {
      current_user?: { username?: string; name?: string; avatar_template?: string }
    }
    const username = data.current_user?.username
    if (!username) throw new ApiError('无法读取当前用户，请检查 key 与 scopes', 502)
    return {
      username,
      name: data.current_user?.name,
      avatarTemplate: data.current_user?.avatar_template,
    }
  }, 'user')
}

export interface CreatedPost {
  reply_to_post_number?: number | null
  reply_to_user?: { username: string; name?: string } | null
  id: number
  topic_id: number
  post_number: number
  cooked?: string
  username?: string
  name?: string
  created_at?: string
  avatar_template?: string
  errors?: string[]
}

/** 统一取错误原文：优先使用论坛返回的 errors 数组，不做二次包装 */
export function errorMessage(err: unknown): string {
  if (!err) return ''
  const apiError = err as ApiError
  if (Array.isArray(apiError.errors) && apiError.errors.length) {
    return apiError.errors.join('\n')
  }
  return err instanceof Error ? err.message : String(err)
}

/** 点赞：POST /post_actions，返回更新后的帖子（actions_summary 包含点赞状态） */
export function likePost(apiKey: string, postId: number) {
  return writeJSON<Post>('/post_actions.json', 'POST', apiKey, {
    id: postId,
    post_action_type_id: 2,
    flag_topic: false,
  })
}

/** 取消赞：DELETE /post_actions/{id}?post_action_type_id=2 */
export function unlikePost(apiKey: string, postId: number) {
  return writeJSON<Post>(
    `/post_actions/${postId}?post_action_type_id=2`,
    'DELETE',
    apiKey,
  )
}

/** 回复：POST /posts.json（reply_to_post_number 可选） */
export function replyToPost(
  apiKey: string,
  payload: { raw: string; topic_id: number; reply_to_post_number?: number },
) {
  return writeJSON<CreatedPost>('/posts.json', 'POST', apiKey, payload)
}

/** 轻量话题预览：只用于取首帖作者（列表接口不返回 users 数组） */
export function fetchTopicPreview(id: number, signal?: AbortSignal) {
  return getJSON<{
    post_stream?: { posts?: import('./types').Post[] }
    details?: { created_by?: import('./types').ForumUser }
  }>(`/t/${id}.json`, signal, 'prefetch')
}

/** 发新帖：POST /posts.json（raw + title + category + tags[]） */
export function createTopic(
  apiKey: string,
  payload: { raw: string; title: string; category?: number; tags?: string[] },
) {
  return writeJSON<CreatedPost>('/posts.json', 'POST', apiKey, payload)
}

export interface NotificationsPage {
  notifications: NotificationItem[]
  total_rows_notifications?: number
  /** 有下一页时是带 offset 的 URL 字符串，没有则为 null */
  load_more_notifications?: string | null
}

const NOTIF_CACHE_TTL_MS = 5 * 60_000

/** 通知首页缓存：先渲染上次结果，再在后台刷新 */
export function peekNotifications(apiKey: string, limit = 40): NotificationsPage | null {
  return readCache<NotificationsPage>(`notif:${apiKey.slice(-8)}:${limit}:0`, NOTIF_CACHE_TTL_MS)
}

/** 通知列表：需要登录，代理不缓存；分页用 offset（limit 为每页条数） */
export function fetchNotifications(
  apiKey: string,
  limit = 40,
  offset = 0,
  signal?: AbortSignal,
) {
  return getWithKey<NotificationsPage>(
    `/notifications.json?limit=${limit}&offset=${offset}`,
    apiKey,
    signal,
    'user',
  ).then((data) => {
    if (offset === 0) writeCache(`notif:${apiKey.slice(-8)}:${limit}:0`, data)
    return data
  })
}

const PROFILE_CACHE_TTL_MS = 15 * 60_000

export function peekUserProfile(username: string): UserProfile | null {
  return readCache<UserProfile>(`profile:${username}`, PROFILE_CACHE_TTL_MS)
}

/** 用户主页资料：该站点对匿名访问隐藏资料，必须带 User-Api-Key */
export function fetchUserProfile(username: string, apiKey: string, signal?: AbortSignal) {
  return getWithKey<{ user: UserProfile }>(
    `/u/${encodeURIComponent(username)}.json`,
    apiKey,
    signal,
    'normal',
  ).then((data) => {
    if (data.user) writeCache(`profile:${username}`, data.user)
    return data.user
  })
}

// 按完整账号凭据隔离的内存缓存，不将个人列表写入公共缓存。
const createdTopicCache = new Map<string, Map<string, { at: number; list: TopicList }>>()
export function peekCreatedTopics(username: string, page: number, apiKey: string): TopicList | null {
  const entry = createdTopicCache.get(apiKey)?.get(`${username}:${page}`)
  return entry && Date.now() - entry.at < 5 * 60_000 ? entry.list : null
}

/** 用户创建的帖子（笔记） */
export function fetchCreatedTopics(
  username: string,
  page: number,
  apiKey: string,
  signal?: AbortSignal,
) {
  return getWithKey<{ topic_list: TopicList; users?: ForumUser[] }>(
    `/topics/created-by/${encodeURIComponent(username)}.json?page=${page}`,
    apiKey,
    signal,
    'normal',
  ).then((data) => {
    const list = { ...data.topic_list, users: data.users?.length ? data.users : data.topic_list.users }
    let account = createdTopicCache.get(apiKey)
    if (!account) { account = new Map(); createdTopicCache.set(apiKey, account) }
    account.set(`${username}:${page}`, { at: Date.now(), list })
    if (account.size > 30) account.delete(account.keys().next().value!)
    if (createdTopicCache.size > 4) createdTopicCache.delete(createdTopicCache.keys().next().value!)
    return list
  })
}

/** 用户点赞过的帖子：offset 分页，filter=1 表示点赞 */
export function fetchUserActions(
  username: string,
  offset: number,
  apiKey: string,
  filter = 1,
  signal?: AbortSignal,
) {
  return getWithKey<{ user_actions: UserActionItem[] }>(
    `/user_actions.json?username=${encodeURIComponent(username)}&filter=${filter}&offset=${offset}`,
    apiKey,
    signal,
    'normal',
  ).then((data) => data.user_actions || [])
}

/** 我的收藏：只允许本人，必须带 key */
export function fetchBookmarks(username: string, apiKey: string, signal?: AbortSignal) {
  return getWithKey<{ user_bookmark_list?: { bookmarks?: BookmarkItem[] } }>(
    `/u/${encodeURIComponent(username)}/bookmarks.json`,
    apiKey,
    signal,
    'normal',
  ).then((data) => data.user_bookmark_list?.bookmarks || [])
}

const FEATURED_KEY = 'featured'

/** 社区置顶：站点用 tag=featured 维护首页推荐位 */
export function peekFeaturedTopics(): TopicList | null {
  return readCache<TopicList>(FEATURED_KEY, FEED_CACHE_TTL_MS)
}

export function fetchFeaturedTopics(signal?: AbortSignal) {
  return getJSON<{ topic_list: TopicList; users?: ForumUser[] }>(
    '/tag/featured.json',
    signal,
    'normal',
  ).then((data) => {
    const list = {
      ...data.topic_list,
      users: data.users?.length ? data.users : data.topic_list.users,
    }
    writeCache(FEATURED_KEY, list)
    return list
  })
}

/**
 * 首屏之后的后台预取：周榜与分类，失败静默、最多重试一次。
 * 正常情况下会被 300ms 去重窗口与持久化缓存吸收，不会额外交互。
 */
export function prefetchHomeExtras() {
  if (!getCachedCategories()) fetchCategories().catch(() => undefined)
}

export function prefetchTopic(id: number) {
  getJSON<unknown>(`/t/${id}.json?page=1`, undefined, 'prefetch', 1).catch(() => undefined)
}

/**
 * discourse-chat：我的频道列表。
 * 站点没有 /chat/api/direct-message-channels（404），私信与公开频道都从这里读取。
 */
const CHAT_CACHE_TTL_MS = 5 * 60_000

export function peekChatOverview(apiKey: string): ChatOverview | null {
  return readCache<ChatOverview>(`chat:${apiKey.slice(-8)}`, CHAT_CACHE_TTL_MS)
}

export function fetchChatOverview(apiKey: string, signal?: AbortSignal) {
  return getWithKey<ChatOverview>('/chat/api/me/channels', apiKey, signal, 'user').then((data) => {
    writeCache(`chat:${apiKey.slice(-8)}`, data)
    return data
  })
}

export function peekChatChannels(apiKey: string): ChatChannel[] | null {
  return readCache<ChatChannel[]>(`chat-channels:${apiKey.slice(-8)}`, CHAT_CACHE_TTL_MS)
}

/** 全部公开频道：与私信列表分别缓存、分别恢复。 */
export function fetchChatChannels(apiKey: string, signal?: AbortSignal) {
  return getWithKey<{ channels?: ChatChannel[] }>('/chat/api/channels', apiKey, signal, 'user').then((data) => {
    const channels = data.channels || []
    writeCache(`chat-channels:${apiKey.slice(-8)}`, channels)
    return channels
  })
}

/**
 * 频道消息：首次不带方向参数取最新一页；
 * 向上加载用 direction=past + target_message_id（站点实际字段，before_message_id 也可用）。
 */
export function fetchChatMessages(
  channelId: number,
  apiKey: string,
  opts: { beforeId?: number; afterId?: number; aroundId?: number; pageSize?: number } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams()
  query.set('page_size', String(opts.pageSize ?? 50))
  if (opts.aroundId) query.set('target_message_id', String(opts.aroundId))
  else if (opts.beforeId || opts.afterId) {
    query.set('direction', opts.beforeId ? 'past' : 'future')
    query.set('target_message_id', String(opts.beforeId || opts.afterId))
  }
  return getWithKey<ChatMessagesResponse>(
    `/chat/api/channels/${channelId}/messages?${query.toString()}`,
    apiKey,
    signal,
    'user',
  )
}

/**
 * 发送聊天消息。
 * 实测（discourse-chat）真实写接口是 POST /chat/{channelId}，body { message }，
 * 返回 { success, message_id }；POST /chat/api/channels/{id}/messages 在站点上 404。
 */
export function sendChatMessage(channelId: number, apiKey: string, message: string, uploadIds: number[] = []) {
  return writeJSON<{ success?: string; message_id?: number; id?: number }>(
    `/chat/${channelId}`,
    'POST',
    apiKey,
    { message, upload_ids: uploadIds },
  )
}

/**
 * 表情配置，返回按分组组织的表情。
 * 论坛实际返回的是「分组名 -> 表情数组」的对象（如 { "smileys_&_emotion": [...] }），
 * 也兼容标准 Discourse 的 { emojis: [{ name, emojis: [...] }] } 形式。
 */
export async function fetchEmojis(signal?: AbortSignal): Promise<EmojiGroup[]> {
  const data = await getJSON<unknown>('/emojis.json', signal, 'normal')

  const toGroup = (name: string, list: unknown): EmojiGroup => ({
    name,
    emojis: (Array.isArray(list) ? list : [])
      .map((item): EmojiItem | null => {
        const raw = item as { name?: unknown; url?: unknown; group?: unknown }
        if (typeof raw?.name !== 'string' || typeof raw?.url !== 'string') return null
        return {
          name: raw.name,
          url: raw.url,
          group: typeof raw.group === 'string' ? raw.group : name,
        }
      })
      .filter((item): item is EmojiItem => item !== null),
  })

  if (Array.isArray(data)) return data as EmojiGroup[]
  if (!data || typeof data !== 'object') return []

  const record = data as Record<string, unknown>
  if (Array.isArray(record.emojis)) return record.emojis as EmojiGroup[]
  if (Array.isArray(record.groups)) return record.groups as EmojiGroup[]

  return Object.entries(record)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([name, list]) => toGroup(name, list))
    .filter((group) => group.emojis.length > 0)
}

/** 上传图片：multipart file + type=composer，走代理透传 User-Api-Key */
export async function uploadImage(apiKey: string, file: File, uploadType = 'composer'): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('type', uploadType)
  form.append('upload_type', uploadType)
  return enqueue(async () => {
    const res = await fetch(`${BASE}/uploads.json`, {
      method: 'POST',
      headers: { accept: 'application/json', 'user-api-key': apiKey },
      body: form,
    })
    if (!res.ok) {
      let detail = ''
      let errors: string[] = []
      try {
        const body = (await res.json()) as { error?: string; errors?: string[]; message?: string }
        errors = Array.isArray(body.errors) ? body.errors : []
        detail = body.error || body.message || errors.join('；') || ''
      } catch {
        // ignore
      }
      throw new ApiError(
        formatError(res.status, detail),
        res.status,
        errors,
        retryAfterFromHeaders(res),
      )
    }
    return (await res.json()) as UploadResult
  }, 'user')
}

export function editChatMessage(channelId: number, messageId: number, apiKey: string, message: string, uploadIds: number[]) {
  return writeJSON(`/chat/api/channels/${channelId}/messages/${messageId}`, 'PUT', apiKey, { message, upload_ids: uploadIds })
}
export function deleteChatMessage(channelId: number, messageId: number, apiKey: string) {
  return writeJSON(`/chat/api/channels/${channelId}/messages/${messageId}`, 'DELETE', apiKey)
}
export function pinChatMessage(channelId: number, messageId: number, apiKey: string, pinned: boolean) {
  return writeJSON(`/chat/api/channels/${channelId}/messages/${messageId}/pin`, pinned ? 'POST' : 'DELETE', apiKey)
}
export function rebakeChatMessage(channelId: number, messageId: number, apiKey: string) {
  return writeJSON(`/chat/${channelId}/${messageId}/rebake`, 'PUT', apiKey)
}

/** 点赞用户：携带当前账号凭据，以便读取有权限访问的私信帖子。 */
export function fetchPostLikers(postId: number, apiKey?: string, page = 0, signal?: AbortSignal) {
  const path = `/post_action_users.json?id=${postId}&post_action_type_id=2&page=${page}&limit=30`
  return requestJSON<{ post_action_users: ForumUser[]; total_rows_post_action_users?: number }>(path, apiKey, signal, 'user', 1)
}

/** 私信是 private_message 话题，与即时聊天频道不同。 */
export function createPrivateMessage(apiKey: string, username: string, title: string, raw: string) {
  return writeJSON<CreatedPost>('/posts.json', 'POST', apiKey, {
    archetype: 'private_message', target_recipients: username, title, raw,
  })
}
export function createDirectChat(apiKey: string, username: string) {
  return writeJSON<{ channel: ChatChannel }>('/chat/api/direct-message-channels', 'POST', apiKey, {
    target_usernames: [username], upsert: true,
  })
}

export interface ProfileUpdate {
  name?: string
  title?: string
  bio_raw?: string
  location?: string
  timezone?: string
  hide_profile?: boolean
  card_background_upload_url?: string
}
export async function updateUserProfile(username: string, apiKey: string, changes: ProfileUpdate) {
  const result = await writeJSON<{ user?: UserProfile }>(`/u/${encodeURIComponent(username)}.json`, 'PUT', apiKey, changes)
  if (result.user) writeCache(`profile:${username}`, result.user)
  return result
}
export function changeUsername(username: string, apiKey: string, newUsername: string) {
  return writeJSON<{ username: string }>(`/u/${encodeURIComponent(username)}/preferences/username`, 'PUT', apiKey, { new_username: newUsername })
}
export function pickUserAvatar(username: string, apiKey: string, uploadId: number) {
  return writeJSON(`/u/${encodeURIComponent(username)}/preferences/avatar/pick`, 'PUT', apiKey, { upload_id: uploadId, type: 'custom' })
}
export function featureUserTopic(username: string, apiKey: string, topicId: number | null) {
  return writeJSON(`/u/${encodeURIComponent(username)}/${topicId ? 'feature-topic' : 'clear-featured-topic'}`, 'PUT', apiKey, topicId ? { topic_id: topicId } : {})
}

export async function markAllNotificationsRead(apiKey: string) {
  await writeJSON('/notifications/mark-read.json', 'PUT', apiKey, {})
  removeCache(`notif:${apiKey.slice(-8)}:40:0`)
}

export function createBookmark(apiKey: string, postId: number) {
  return writeJSON<{ id: number }>('/bookmarks.json', 'POST', apiKey, { bookmarkable_id: postId, bookmarkable_type: 'Post' })
}
export function deleteBookmark(apiKey: string, bookmarkId: number) {
  return writeJSON(`/bookmarks/${bookmarkId}.json`, 'DELETE', apiKey)
}
