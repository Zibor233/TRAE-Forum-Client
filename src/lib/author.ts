import { fetchTopicPreview } from '../api'
import type { TopicAuthor } from './topic'

const CACHE_TTL_MS = 10 * 60_000
const STORAGE_PREFIX = 'trae-lite.author.v1:'
const pending = new Map<number, Promise<TopicAuthor | null>>()
/** 作者补全串行执行，两次之间留间隔，避免与信息流/通知一起打满上游限流 */
let chain: Promise<void> = Promise.resolve()
const GAP_MS = 250
/** 失败（含 429）后 60 秒内不再补全同一话题 */
const failedAt = new Map<number, number>()
const FAIL_RETRY_MS = 60_000

interface Stored {
  at: number
  author: TopicAuthor
}

function readStored(topicId: number): TopicAuthor | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${topicId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed?.author?.username || Date.now() - parsed.at > CACHE_TTL_MS) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${topicId}`)
      return null
    }
    return parsed.author
  } catch {
    return null
  }
}

function writeStored(topicId: number, author: TopicAuthor) {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${topicId}`, JSON.stringify({ at: Date.now(), author }))
  } catch {
    // sessionStorage 不可用时忽略，仅用内存缓存
  }
}

async function fetchAuthor(topicId: number): Promise<TopicAuthor> {
  const data = await fetchTopicPreview(topicId)
  const opener =
    data.post_stream?.posts?.find((post) => post.post_number === 1) ||
    data.post_stream?.posts?.[0]
  const createdBy = data.details?.created_by
  if (!opener?.username && !createdBy?.username) {
    throw new Error('没有拿到贴主信息')
  }
  return {
    username: opener?.username || createdBy?.username || '',
    name: opener?.name || createdBy?.name,
    avatarTemplate: opener?.avatar_template || createdBy?.avatar_template,
    admin: opener?.admin || createdBy?.admin,
    moderator: opener?.moderator || createdBy?.moderator,
    group: createdBy?.primary_group_name || null,
  }
}

/**
 * 作者补全：同 topic 只请求一次；结果写 sessionStorage（TTL 10 分钟），刷新不重复拉。
 * 429 时静默回落（卡片继续用 posters[0]/贴主兜底），按 retryAfter 自动重试一次，绝不抛到界面。
 */
export function loadTopicAuthor(topicId: number): Promise<TopicAuthor | null> {
  const stored = readStored(topicId)
  if (stored) return Promise.resolve(stored)

  const existing = pending.get(topicId)
  if (existing) return existing

  const recentlyFailed = failedAt.get(topicId)
  if (recentlyFailed && Date.now() - recentlyFailed < FAIL_RETRY_MS) return Promise.resolve(null)

  const promise = new Promise<TopicAuthor>((resolve, reject) => {
    chain = chain.then(async () => {
      await new Promise((r) => setTimeout(r, GAP_MS))
      try {
        resolve(await fetchAuthor(topicId))
      } catch (error) {
        reject(error)
      }
    })
  })
    .then((author) => {
      if (author.username) writeStored(topicId, author)
      return author
    })
    .catch(async (error: unknown) => {
      const status = (error as { status?: number } | null)?.status
      if (status === 429) {
        const retryAfter = (error as { retryAfter?: number }).retryAfter
        const wait = Math.max(1, Math.min(60, Math.round(retryAfter || 5)))
        console.warn(`[author] 作者补全被限流，${wait}s 后重试一次 (topic ${topicId})`)
        await new Promise((resolve) => setTimeout(resolve, wait * 1000))
        try {
          const author = await fetchAuthor(topicId)
          if (author.username) writeStored(topicId, author)
          return author
        } catch {
          failedAt.set(topicId, Date.now())
          return null
        }
      }
      failedAt.set(topicId, Date.now())
      return null
    })
    .finally(() => {
      pending.delete(topicId)
    })

  pending.set(topicId, promise)
  return promise
}
