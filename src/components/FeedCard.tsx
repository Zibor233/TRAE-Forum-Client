import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { Category, ForumUser, Topic } from '../types'
import { compactNumber, coverPalette, firstChar, topicImage } from '../lib/format'
import { authorBadge, resolveTopicAuthor, type TopicAuthor } from '../lib/topic'
import { loadTopicAuthor } from '../lib/author'
import { prefetchTopic } from '../api'
import Avatar from './Avatar'
import { openUserCard } from '../lib/userCard'
import { textCoverText } from '../lib/cover'
export { textCoverText } from '../lib/cover'
import { AUTH_EVENT, loadSession } from '../lib/auth'
import { LIKES_EVENT, readTopicLike } from '../lib/likes'
import { CommentIcon, HeartIcon } from './icons'

/**
 * 悬停预取预算：同一屏最多 3 个话题，滚动跨屏后重置。
 * 预取走最低优先级队列，失败静默、最多重试一次。
 */
const hoverBudget = { count: 0, scrollY: 0 }

function maybePrefetch(topicId: number) {
  if (Math.abs(window.scrollY - hoverBudget.scrollY) >= window.innerHeight) {
    hoverBudget.count = 0
    hoverBudget.scrollY = window.scrollY
  }
  if (hoverBudget.count >= 3) return
  hoverBudget.count += 1
  prefetchTopic(topicId)
}

interface FeedCardProps {
  topic: Topic
  category?: Category
  users?: ForumUser[]
}

/**
 * 封面比例按话题 id 稳定计算，首次渲染即确定：
 * 之前用 onLoad 读取 naturalWidth 改比例会让卡片高度在图片解码后才跳变，
 * 是信息流滚动抖动/CLS 的主要来源。
 */
export function feedCardRatio(topic: Topic) {
  return [4 / 3, 1, 3 / 4][Math.abs(topic.id) % 3]
}

export function feedCardTextHeight(topic: Topic) {
  return 168 + (Math.abs(topic.id) % 4) * 26
}

/** 供瀑布流分列使用的估算高度（只用于比较，不参与真实布局） */
export function feedCardEstimate(topic: Topic) {
  const coverHeight = 300 / feedCardRatio(topic)
  if (topicImage(topic)) return coverHeight + 78
  // 文字封面固定 4/3 比例，与 id 无关
  return textCoverText(topic) ? 300 * 3 / 4 + 78 : feedCardTextHeight(topic) + 38
}

export default function FeedCard({ topic, category, users }: FeedCardProps) {
  const readLike = () => {
    const session = loadSession()
    return session ? readTopicLike(session.username, topic.id) : null
  }
  const [likeState, setLikeState] = useState(readLike)
  useEffect(() => {
    const refresh = () => setLikeState(readLike())
    refresh()
    window.addEventListener(LIKES_EVENT, refresh)
    window.addEventListener(AUTH_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(LIKES_EVENT, refresh)
      window.removeEventListener(AUTH_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [topic.id])
  const likes = likeState?.count ?? topic.like_count ?? 0
  const cover = topicImage(topic)
  const coverText = cover ? null : textCoverText(topic)
  const { bg, fg } = coverPalette(topic.id)
  const ratio = feedCardRatio(topic)
  const [author, setAuthor] = useState<TopicAuthor>(() => resolveTopicAuthor(topic, users))
  const rootRef = useRef<HTMLAnchorElement>(null)
  const hoverTimer = useRef<number | null>(null)

  // 列表接口已带 users 时直接用贴主头像，不再逐卡请求；只有缺 users 时才按视口补全
  const hasUsers = Boolean(users?.length)
  useEffect(() => {
    const node = rootRef.current
    if (hasUsers || !node || typeof IntersectionObserver === 'undefined') return
    let alive = true
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        loadTopicAuthor(topic.id)
          .then((next) => {
            if (alive && next?.username) setAuthor(next)
          })
          .catch(() => undefined)
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [topic.id, hasUsers])

  useEffect(() => {
    if (hasUsers) setAuthor(resolveTopicAuthor(topic, users))
  }, [topic, users, hasUsers])

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
  }, [])

  const badge = authorBadge(author)
  const commentCount = Math.max(0, (topic.posts_count || 0) - 1)
  const textHeight = feedCardTextHeight(topic)

  const openProfile = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    openUserCard(author.username)
  }

  return (
    <a
      ref={rootRef}
      data-feed-card
      href={`#/topic/${topic.id}`}
      className="group block"
      onMouseEnter={() => {
        if (hoverTimer.current) return
        hoverTimer.current = window.setTimeout(() => {
          hoverTimer.current = null
          maybePrefetch(topic.id)
        }, 100)
      }}
      onMouseLeave={() => {
        if (hoverTimer.current) {
          window.clearTimeout(hoverTimer.current)
          hoverTimer.current = null
        }
      }}
    >
      {cover ? (
        <div
          className="relative w-full overflow-hidden rounded-lg bg-line/30"
          style={{ aspectRatio: String(ratio) }}
        >
          <img
            src={cover}
            alt={topic.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition duration-300 group-hover:opacity-95"
          />
          {(topic.pinned || topic.pinned_globally) && (
            <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10.5px] text-white">
              置顶
            </span>
          )}
          {topic.has_accepted_answer && (
            <span className="absolute right-2 top-2 rounded bg-ok-soft0/90 px-1.5 py-0.5 text-[10.5px] text-white">
              已解决
            </span>
          )}
        </div>
      ) : coverText ? (
        <div
          className="cover-tint text-cover relative flex w-full items-center overflow-hidden rounded-lg p-4"
          style={
            {
              '--cov-bg': bg,
              '--cov-fg': fg,
              aspectRatio: '4 / 3',
            } as CSSProperties
          }
        >
          <p className="cover-title text-cover__title line-clamp-3 w-full">{coverText}</p>
          <span className="cover-title absolute bottom-2.5 right-3 max-w-[70%] truncate text-[10.5px] font-medium opacity-60">
            {author.name || author.username || '匿名用户'}
          </span>
        </div>
      ) : (
        <div
          className="cover-tint flex w-full flex-col justify-between overflow-hidden rounded-lg p-3.5"
          style={
            {
              '--cov-bg': bg,
              '--cov-fg': fg,
              minHeight: textHeight,
            } as CSSProperties
          }
        >
          <p className="cover-title line-clamp-4 text-[14px] font-medium leading-[1.5]">
            {topic.title}
          </p>
          <span className="cover-title mt-3 select-none text-[26px] font-semibold leading-none opacity-40">
            {firstChar(topic.title)}
          </span>
        </div>
      )}

      {(cover || coverText) && (
        <div className="mt-2.5 px-0.5">
          <h3 className="line-clamp-2 text-[14px] font-medium leading-[1.45] text-ink group-hover:text-[#ff2442]">
            {topic.title}
          </h3>
          {category && <span className="mt-1 block text-[11.5px] text-sub/80">{category.name}</span>}
        </div>
      )}

      {!cover && !coverText && category && (
        <div className="mt-2 px-0.5 text-[11.5px] text-sub/80">{category.name}</div>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-sub">
        {author.username && author.username !== '匿名用户' ? (
          <button
            type="button"
            onClick={openProfile}
            title={`${author.name || author.username} 的主页`}
            className="flex min-w-0 items-center gap-1.5 text-left transition hover:text-ink"
          >
            <Avatar template={author.avatarTemplate} name={author.name || author.username} size={18} />
            <span className="min-w-0 truncate">{author.name || author.username}</span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar name={author.username || '匿名用户'} size={18} />
            <span className="min-w-0 truncate">{author.username || '匿名用户'}</span>
          </span>
        )}
        {badge && (
          <span className="shrink-0 rounded bg-warn-soft px-1 text-[10px] leading-[16px] text-warn">
            {badge}
          </span>
        )}
        {commentCount > 0 && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5">
            <CommentIcon className="h-3.5 w-3.5 text-sub/70" />
            {compactNumber(commentCount)}
          </span>
        )}
        {(likes > 0 || likeState?.liked) && (
          <span className={`inline-flex shrink-0 items-center gap-0.5 ${commentCount > 0 ? '' : 'ml-auto'}`}>
            <HeartIcon className={`h-3.5 w-3.5 ${likeState?.liked ? 'text-[#ff2442] [&_path]:fill-current' : 'text-sub/70'}`} />
            {compactNumber(likes)}
          </span>
        )}
      </div>
    </a>
  )
}
