import type { Post } from '../types'

export const LIKES_EVENT = 'trae-lite:likes-changed'
export const postLiked = (post?: Post) => Boolean(post?.actions_summary?.find((a) => a.id === 2)?.acted)
interface TopicLikeState { liked: boolean; count: number; at: number }
const memory = new Map<string, TopicLikeState>()
const keyFor = (username: string, topicId: number) => `trae-lite.likes.v2:${encodeURIComponent(username)}:${topicId}`
export function readTopicLike(username: string, topicId: number): TopicLikeState | null {
  const key = keyFor(username, topicId)
  try {
    const value = memory.get(key) || JSON.parse(localStorage.getItem(key) || 'null')
    return value && Date.now() - value.at < 10 * 60_000 ? value : null
  } catch { return null }
}
export function publishTopicLike(username: string, topicId: number, liked: boolean, count: number) {
  const value = { liked, count: Math.max(0, count), at: Date.now() }
  const key = keyFor(username, topicId)
  memory.set(key, value)
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* cache is optional */ }
  window.dispatchEvent(new Event(LIKES_EVENT))
}

/** The serializer omits can_undo when the current viewer cannot revoke a like. */
export const postCanUnlike = (post?: Post) => {
  const action = post?.actions_summary?.find(item => item.id === 2)
  return Boolean(action?.acted && action.can_undo)
}
