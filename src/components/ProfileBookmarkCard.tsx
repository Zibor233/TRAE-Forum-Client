import { useEffect, useRef, useState } from 'react'
import { errorMessage, fetchBookmarkTopic } from '../api'
import type { BookmarkItem, Category, ForumUser, TopicDetail } from '../types'
import { postLikeCount } from '../lib/format'
import FeedCard from './FeedCard'

/** Fetch details only near the viewport; private bookmarks never use public requests. */
export default function ProfileBookmarkCard({ item, apiKey, categories, onOpen }: {
  item: BookmarkItem; apiKey: string; categories: Category[]; onOpen: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [detail, setDetail] = useState<TopicDetail | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let started = false
    setDetail(null)
    setError('')
    const load = () => {
      if (started) return
      started = true
      void fetchBookmarkTopic(item.topic_id, apiKey, controller.signal).then((data) => {
        if (!controller.signal.aborted) setDetail(data)
      }).catch((err) => { if (!controller.signal.aborted) setError(errorMessage(err)) })
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load() }
    }, { rootMargin: '200px 0px' })
    if (root.current) observer.observe(root.current)
    return () => { observer.disconnect(); controller.abort() }
  }, [item.topic_id, apiKey, retry])

  const opener = detail?.post_stream.posts.find(post => post.post_number === 1)
  const author: ForumUser | undefined = opener ? {
    id: opener.user_id ?? detail?.details?.created_by?.id ?? 0, username: opener.username, name: opener.name,
    avatar_template: opener.avatar_template, admin: opener.admin, moderator: opener.moderator,
  } : detail?.details?.created_by
  return <div ref={root} data-bookmark-card>
    {detail ? <FeedCard
      topic={{ ...detail, user_id: author?.id, posters: author ? [{ user_id: author.id, description: 'Original Poster' }] : detail.posters,
        like_count: opener ? postLikeCount(opener) : 0, excerpt: detail.excerpt || opener?.cooked || item.excerpt || detail.title,
      }}
      users={author ? [author] : undefined}
      targetPostNumber={item.post_number}
      bookmarkPost={(() => {
        const post = detail.post_stream.posts.find(post => post.post_number === (item.post_number || 1))
        return post ? { ...post, bookmark_id: item.id } : undefined
      })()}
      category={categories.find(category => category.id === detail.category_id)}
    /> : <div className="overflow-hidden rounded-xl bg-surface">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className={`aspect-[4/3] bg-line/50 ${error ? '' : 'animate-pulse'}`} />
        <p className="line-clamp-2 px-3 pt-3 text-sm font-medium text-ink">{item.title || '收藏的话题'}</p>
      </button>
      <div className="px-3 pb-3 pt-2 text-xs text-sub">{error
        ? <button type="button" onClick={() => setRetry(value => value + 1)} className="underline underline-offset-2">封面加载失败，点击重试</button>
        : '正在加载封面…'}</div>
    </div>}
  </div>
}
