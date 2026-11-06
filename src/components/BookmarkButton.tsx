import { useEffect, useRef, useState } from 'react'
import { createBookmark, deleteBookmark, errorMessage, fetchTopic } from '../api'
import type { Post } from '../types'
import { BookmarkIcon } from './icons'

export default function BookmarkButton({ post, topicId, compact, apiKey, onRequireLogin, onError }: { post?: Post; topicId?: number; compact?: boolean; apiKey?: string; onRequireLogin: () => void; onError: (message: string) => void }) {
  const [bookmarkId, setBookmarkId] = useState<number | null>(post?.bookmark_id || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setBookmarkId(apiKey ? post?.bookmark_id || null : null)
    setError('')
    return () => { generation.current++ }
  }, [post?.id, post?.bookmark_id, apiKey])
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (apiKey && topicId && detail?.topicId === topicId) setBookmarkId(detail.bookmarkId)
    }
    window.addEventListener('trae:bookmarks-changed', changed)
    return () => window.removeEventListener('trae:bookmarks-changed', changed)
  }, [apiKey, topicId])
  const toggle = async () => {
    if (!apiKey) { onRequireLogin(); return }
    if ((!post && !topicId) || lock.current) return
    lock.current = true; setBusy(true); setError(''); onError('')
    const current = generation.current
    try {
      const target = post || (await fetchTopic(topicId!, 1, undefined, apiKey)).post_stream.posts.find(item => item.post_number === 1)
      if (!target) throw new Error('未找到帖子，请重新加载')
      const currentBookmarkId = post ? bookmarkId : target.bookmark_id
      let nextBookmarkId: number | null = null
      if (currentBookmarkId) {
        await deleteBookmark(apiKey, currentBookmarkId)
        if (generation.current === current) setBookmarkId(null)
      } else {
        const result = await createBookmark(apiKey, target.id)
        if (!Number.isInteger(result.id) || result.id <= 0) throw new Error('收藏状态未返回，请重新打开帖子确认')
        nextBookmarkId = result.id
        if (generation.current === current) setBookmarkId(result.id)
      }
      if (generation.current === current) window.dispatchEvent(new CustomEvent('trae:bookmarks-changed', { detail: { topicId: topicId || target.topic_id, bookmarkId: nextBookmarkId } }))
    } catch (err) { if (generation.current === current) {
      const message = errorMessage(err) || '收藏操作失败，请重试'
      setError(message); onError(message)
    } }
    finally { lock.current = false; setBusy(false) }
  }
  return <span className="relative inline-flex shrink-0">
    <button type="button" aria-label={bookmarkId ? '取消收藏' : '收藏'} aria-pressed={Boolean(bookmarkId)} title={error || (bookmarkId ? '取消收藏' : '收藏')} disabled={busy || (!post && !topicId)} onClick={() => void toggle()} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[12px] disabled:opacity-50 ${bookmarkId ? 'text-accent' : 'text-sub hover:text-ink'}`}>
      <BookmarkIcon className={`h-4 w-4 ${bookmarkId ? '[&_path]:fill-current' : ''}`} />
      {!compact && <span className="hidden sm:inline">{bookmarkId ? '已收藏' : '收藏'}</span>}
    </button>
  </span>
}
