import LoadingIndicator from './LoadingIndicator'
﻿import { lockBodyScroll } from '../lib/scrollLock'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CommentIcon,
  EmojiIcon,
  HeartIcon,
  ImageIcon,
  SendIcon,
  ShareIcon,
} from './icons'
import {
  errorMessage,
  fetchCategories,
  fetchTopic,
  likePost,
  replyToPost,
  unlikePost,
  uploadImage,
  type CreatedPost,
} from '../api'
import EmojiPicker from './EmojiPicker'
import Avatar from './Avatar'
import { openUserCard } from '../lib/userCard'
import LikeButton from './LikeButton'
import { FORUM_ORIGIN, type AuthSession } from '../lib/auth'
import { errorStatus } from '../lib/errors'
import {
  absolutize,
  compactNumber,
  coverPalette,
  fullDate,
  postLikeCount,
  sanitizeCooked,
  timeAgo,
} from '../lib/format'
import type { Category, Post, TopicDetail } from '../types'
import { postLiked, publishTopicLike } from '../lib/likes'
import { textCoverText } from '../lib/cover'

interface TopicModalProps {
  id: number
  session: AuthSession | null
  focusPostNumber?: number
  initialReply?: boolean
  onClose: () => void
  onRequireLogin: () => void
}

export default function TopicModal({
  id,
  session,
  focusPostNumber,
  initialReply,
  onClose,
  onRequireLogin,
}: TopicModalProps) {
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [category, setCategory] = useState<Category | undefined>()
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<number | null>(null)
  const [addedPosts, setAddedPosts] = useState<Post[]>([])
  const [imageIndex, setImageIndex] = useState(0)
  const [replyTo, setReplyTo] = useState<{ postNumber: number; username: string } | null>(null)
  const [shared, setShared] = useState('')
  const [composerExpanded, setComposerExpanded] = useState(false)
  const [nextPage, setNextPage] = useState(2)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  const moreBusyRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const focusAppliedRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    requestRef.current = controller
    moreBusyRef.current = false
    setLoadingMore(false)
    setMoreError('')
    setNextPage(2)
    setHasMore(false)
    let alive = true
    setStatus('loading')
    setTopic(null)
    setError('')
    setErrorCode(null)
    setAddedPosts([])
    setImageIndex(0)
    setReplyTo(null)
    setComposerExpanded(false)
    focusAppliedRef.current = false

    fetchTopic(id, 1, controller.signal, session?.key)
      .then((data) => {
        if (!alive) return
        setTopic(data)
        setHasMore(data.post_stream.posts.length < data.posts_count)
        setStatus('idle')
      })
      .catch((err) => {
        if (!alive) return
        setStatus('error')
        setError(err instanceof Error ? err.message : '话题加载失败')
        setErrorCode(errorStatus(err))
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [id, session?.key])

  useEffect(() => {
    if (!topic?.category_id) return
    fetchCategories()
      .then((list) => setCategory(list.find((item) => item.id === topic.category_id)))
      .catch(() => undefined)
  }, [topic?.category_id])

  // 禁止背景滚动
  useEffect(() => {
    return lockBodyScroll()
  }, [])

  const loadMoreComments = useCallback(async () => {
    const controller = requestRef.current
    if (!topic || !hasMore || moreBusyRef.current || !controller || controller.signal.aborted) return
    moreBusyRef.current = true
    setLoadingMore(true)
    setMoreError('')
    try {
      const data = await fetchTopic(id, nextPage, controller.signal, session?.key)
      if (controller.signal.aborted) return
      const known = new Set(topic.post_stream.posts.map((post) => post.id))
      const fresh = data.post_stream.posts.filter((post) => !known.has(post.id))
      const merged = [...topic.post_stream.posts, ...fresh]
      setTopic({ ...topic, post_stream: { ...topic.post_stream, posts: merged } })
      setHasMore(fresh.length > 0 && merged.length < data.posts_count && nextPage < 15)
      setNextPage(nextPage + 1)
    } catch (err) {
      if (!controller.signal.aborted) setMoreError(errorMessage(err))
    } finally {
      if (!controller.signal.aborted) {
        moreBusyRef.current = false
        setLoadingMore(false)
      }
    }
  }, [topic, hasMore, id, nextPage, session?.key])

  // 以弹层内部为滚动容器，接近底部时加载；失败后等待用户重试。
  useEffect(() => {
    const root = scrollRef.current
    const sentinel = commentsEndRef.current
    if (status !== 'idle' || !root || !sentinel || !hasMore || loadingMore || moreError) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreComments()
    }, { root, rootMargin: '0px 0px 240px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [status, hasMore, loadingMore, moreError, loadMoreComments])

  // 通知深链自动追到目标楼层，正文仍在第一页返回时立即可读。
  useEffect(() => {
    if (focusPostNumber && topic && hasMore && !loadingMore && !moreError &&
        !topic.post_stream.posts.some((post) => post.post_number === focusPostNumber)) {
      void loadMoreComments()
    }
  }, [topic, focusPostNumber, hasMore, loadingMore, moreError, loadMoreComments])

  const posts = useMemo(() => {
    if (!topic) return []
    const regular = topic.post_stream.posts.filter((post) => post.post_type === 1 && !post.hidden)
    const base = regular.length ? regular : topic.post_stream.posts
    const merged = [...base]
    for (const extra of addedPosts) {
      if (!merged.some((post) => post.id === extra.id)) merged.push(extra)
    }
    return merged.sort((a, b) => a.post_number - b.post_number)
  }, [topic, addedPosts])

  const opener = posts[0]
  const comments = posts.filter((post) => post.post_number > 1)
  const commentCount = topic ? Math.max(0, topic.posts_count - 1) + Math.max(0, addedPosts.length) : 0

  const coverText = useMemo(() => {
    if (!topic) return ''
    // 与列表共用摘要截取规则，详情没有 excerpt 时从首帖正文取纯文本。
    const doc = new DOMParser().parseFromString(opener?.cooked || '', 'text/html')
    doc.querySelectorAll('script, style').forEach((node) => node.remove())
    return textCoverText({ excerpt: topic.excerpt || doc.body.textContent || '' }) || topic.title
  }, [topic?.excerpt, topic?.title, opener?.cooked])
  const coverColors = coverPalette(id)

  const images = useMemo(() => {
    if (!opener) return []
    return extractImages(opener.cooked, topic?.image_url)
  }, [opener, topic?.image_url])

  useEffect(() => {
    setImageIndex(0)
  }, [images.length])

  // 从通知进入时定位到目标楼层；reply=1 时直接展开该楼层的回复框（只执行一次）
  useEffect(() => {
    if (status !== 'idle' || !topic || !focusPostNumber || focusAppliedRef.current) return
    if (initialReply) {
      const target = posts.find((post) => post.post_number === focusPostNumber)
      setReplyTo({
        postNumber: focusPostNumber,
        username: target ? displayName(target) : '楼主',
      })
      focusAppliedRef.current = true
      return
    }
    // 帖子可能还没渲染出来（长话题分批渲染），此时不标记已执行，等 posts 更新后重试
    if (!posts.length) return
    const timers: number[] = []
    const align = () => {
      const container = scrollRef.current
      if (!container) return false
      const el = container.querySelector<HTMLElement>(`#c-${focusPostNumber}`)
      if (!el) return false
      const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top
      container.scrollTo({ top: container.scrollTop + delta - 8, behavior: 'smooth' })
      return true
    }
    const timer = setTimeout(() => {
      if (!align()) return
      focusAppliedRef.current = true
      // 图片解码后楼层位置可能下移，多次校准直到稳定
      for (const delay of [600, 1500, 2800]) timers.push(setTimeout(align, delay))
    }, 160)
    timers.push(timer)
    return () => timers.forEach((id) => clearTimeout(id))
  }, [status, topic, posts, focusPostNumber, initialReply])

  // Esc 关闭，左右方向键切图
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (!images.length) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setImageIndex((prev) => (prev - 1 + images.length) % images.length)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setImageIndex((prev) => (prev + 1) % images.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [images.length, onClose])

  const appendCreatedPost = (created: CreatedPost) => {
    const post: Post = {
      id: created.id,
      post_number: created.post_number,
      username: created.username || session?.username || '我',
      name: created.name,
      created_at: created.created_at || new Date().toISOString(),
      cooked: created.cooked || '<p>回复已提交。</p>',
      avatar_template: created.avatar_template,
      post_type: 1,
      topic_id: created.topic_id,
      reply_to_post_number: created.reply_to_post_number,
      reply_to_user: created.reply_to_user,
      actions_summary: [{ id: 2, count: 0 }],
    }
    setAddedPosts((prev) => [...prev.filter((item) => item.id !== post.id), post])
    setTimeout(() => {
      document.getElementById(`c-${post.post_number}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
  }

  const jumpToComments = () => {
    const container = scrollRef.current
    const first = container?.querySelector<HTMLElement>('[data-first-comment]')
    if (!container || !first) return
    const delta = first.getBoundingClientRect().top - container.getBoundingClientRect().top
    if (delta <= 4) return
    container.scrollTo({ top: container.scrollTop + delta - 8, behavior: 'smooth' })
  }

  const share = async () => {
    const url = `${FORUM_ORIGIN}/t/${id}`
    try {
      await navigator.clipboard.writeText(url)
      setShared('原帖链接已复制')
    } catch {
      window.prompt('请复制官方原帖链接', url)
      setShared('请复制原帖链接')
    }
    setTimeout(() => setShared(''), 2500)
  }

  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/55 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-panel-enter relative flex h-full w-full flex-col overflow-hidden bg-surface sm:h-[85vh] sm:max-h-[880px] sm:w-[min(1180px,94vw)] sm:rounded-2xl md:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white md:hidden"
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        {status === 'loading' && (
          <div className="grid h-full w-full place-items-center">
            <LoadingIndicator label="正在加载话题" />
          </div>
        )}

        {status === 'error' && (
          <div className="grid h-full w-full place-items-center px-8 text-center">
            <div className="max-w-[360px]">
              <p className="text-sm text-ink">
                {errorCode === 404
                  ? '该话题已删除或不存在'
                  : errorCode === 401 || errorCode === 403
                    ? '无权限查看该话题'
                    : error || '话题加载失败'}
              </p>
              {(errorCode === 401 || errorCode === 403) && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
                  如果这是私信，请前往消息页查看。
                </p>
              )}
              {(errorCode === 401 || errorCode === 403) && (
                <button
                  onClick={() => {
                    window.location.hash = '/messages'
                  }}
                  className="mt-5 rounded-full bg-accent-fill px-5 py-2 text-[13px] font-medium text-white"
                >
                  打开消息
                </button>
              )}
              <button
                onClick={onClose}
                className={`mt-5 rounded-full bg-btn px-5 py-2 text-[13px] font-medium text-white ${
                  errorCode === 401 || errorCode === 403 ? 'ml-3' : ''
                }`}
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {status === 'idle' && topic && (
          <>
            {/* 左侧媒体区 */}
            <div className="relative flex h-[42vh] w-full shrink-0 items-center justify-center bg-[#111] md:h-auto md:w-[58%]">
              {images.length ? (
                <img
                  src={images[imageIndex]}
                  alt={topic.title}
                  referrerPolicy="no-referrer"
                  className="max-h-full max-w-full select-none object-contain"
                />
              ) : (
                <div
                  className="cover-tint relative flex h-full w-full flex-col justify-center gap-6 px-8 py-16 sm:px-12"
                  style={{ '--cov-bg': coverColors.bg, '--cov-fg': coverColors.fg } as CSSProperties}
                >
                  <p className="cover-title line-clamp-6 text-[clamp(26px,3.5vw,52px)] font-bold leading-[1.4] tracking-tight [text-wrap:balance]">{coverText}</p>
                  <p className="cover-title line-clamp-2 text-[13px] leading-relaxed opacity-60">{topic.title}</p>
                  {opener && <span className="cover-title absolute bottom-8 right-8 text-[13px] opacity-60">{displayName(opener)}</span>}
                </div>
              )}

              {images.length > 1 && (
                <>
                  <button
                    onClick={() => setImageIndex((prev) => (prev - 1 + images.length) % images.length)}
                    aria-label="上一张"
                    className="absolute left-3 top-1/2 image-nav grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none"
                  >
                    <ChevronLeftIcon className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => setImageIndex((prev) => (prev + 1) % images.length)}
                    aria-label="下一张"
                    className="absolute right-3 top-1/2 image-nav grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none"
                  >
                    <ChevronRightIcon className="h-5 w-5" />
                  </button>
                  <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] text-white">
                    {imageIndex + 1}/{images.length}
                  </span>
                </>
              )}

              {images.length === 1 && (
                <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] text-white">
                  1/1
                </span>
              )}

              <button
                onClick={onClose}
                aria-label="关闭"
                className="absolute left-3 top-3 hidden h-8 w-8 place-items-center rounded-full bg-black/40 text-white md:grid"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            {/* 右侧内容区 */}
            <div className="relative flex min-h-0 flex-1 flex-col md:w-[42%]">
              <div className="shrink-0 px-5 pb-3 pt-5 sm:px-6">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => goProfile(opener?.username)}
                    disabled={!opener?.username}
                    aria-label="查看作者主页"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left transition hover:opacity-90"
                  >
                    <Avatar template={opener?.avatar_template} name={displayName(opener)} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-ink">{displayName(opener)}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-sub">
                        {opener ? `@${opener.username}` : ''}
                      </p>
                    </div>
                  </button>
                </div>

                <h1 className="mt-4 text-[20px] font-semibold leading-[1.4] text-ink">{topic.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-sub">
                  <span>{fullDate(topic.created_at).slice(5, 10)}</span>
                  {category && <span>· {category.name}</span>}
                  <span>· {compactNumber(topic.views)} 浏览</span>
                </div>
              </div>

              <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-6"
                style={{
                  paddingBottom: composerExpanded ? 352 : 104,
                  transition: 'padding-bottom 260ms ease-out',
                }}
              >
                {opener && (
                  <div
                    className="post-body mt-1 border-b border-line pb-5"
                    dangerouslySetInnerHTML={{ __html: sanitizeCooked(opener.cooked) }}
                  />
                )}

                <p className="mt-4 text-[13px] text-sub">共 {commentCount} 条评论</p>

                {comments.length === 0 && (
                  <p className="py-10 text-center text-[12.5px] text-sub">{hasMore ? '更多评论尚未加载' : '还没有评论，来抢沙发。'}</p>
                )}

                {comments.map((post, index) => (
                  <CommentItem
                    key={post.id}
                    post={post}
                    replyTarget={posts.find((item) => item.post_number === post.reply_to_post_number)}
                    first={index === 0}
                    session={session}
                    onRequireLogin={onRequireLogin}
                    onReply={() => setReplyTo({ postNumber: post.post_number, username: displayName(post) })}
                  />
                ))}
                {hasMore && (
                  <div ref={commentsEndRef} role="status" aria-live="polite"
                    className="flex min-h-14 items-center justify-center gap-2 text-[12px] text-sub">
                    {moreError ? (
                      <button onClick={() => void loadMoreComments()} className="py-3 underline underline-offset-2">
                        加载失败，点击重试
                      </button>
                    ) : loadingMore ? (
                      <><span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />正在加载评论…</>
                    ) : '下滑加载更多评论'}
                  </div>
                )}
                {!hasMore && topic.post_stream.posts.length < topic.posts_count && (
                  <a className="my-4 block text-center text-sm text-sub" href={`https://forum.trae.cn/t/${id}`} target="_blank" rel="noreferrer">前往论坛查看剩余评论</a>
                )}
              </div>

              <ComposerBar
                session={session}
                topicId={topic.id}
                replyTo={replyTo}
                onClearReplyTo={() => setReplyTo(null)}
                onRequireLogin={onRequireLogin}
                onCreated={appendCreatedPost}
                commentCount={commentCount}
                likeTarget={opener}
                likeCount={topic.like_count}
                onShare={share}
                shared={shared}
                onJumpToComments={jumpToComments}
                onExpandedChange={setComposerExpanded}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CommentItem({
  post,
  replyTarget,
  first,
  session,
  onRequireLogin,
  onReply,
}: {
  post: Post
  replyTarget?: Post
  first?: boolean
  session: AuthSession | null
  onRequireLogin: () => void
  onReply: () => void
}) {
  const initialCount = postLikeCount(post)
  const [liked, setLiked] = useState(postLiked(post))
  const [count, setCount] = useState(initialCount)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLiked(Boolean(session) && postLiked(post))
    setCount(initialCount)
    setError('')
  }, [post, initialCount, session?.key])

  const toggle = async () => {
    if (!session) {
      onRequireLogin()
      return
    }
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = liked ? await unlikePost(session.key, post.id) : await likePost(session.key, post.id)
      setLiked(result.actions_summary ? postLiked(result) : !liked)
      setCount(result.actions_summary ? postLikeCount(result) : Math.max(0, count + (liked ? -1 : 1)))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      id={`c-${post.post_number}`}
      data-first-comment={first ? 'true' : undefined}
      className="scroll-mt-2 border-b border-line/70 py-4 last:border-0"
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => goProfile(post.username)}
          aria-label={`查看 ${displayName(post)} 的主页`}
          className="flex shrink-0 self-start rounded-full transition hover:opacity-90"
        >
          <Avatar template={post.avatar_template} name={displayName(post)} size={28} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-7 items-start justify-between gap-2">
            <button
              onClick={() => goProfile(post.username)}
              className="min-w-0 truncate text-left text-[12.5px] leading-7 text-sub transition hover:text-ink"
            >
              {displayName(post)}
            </button>
            <span className="shrink-0 text-[11.5px] leading-7 text-sub" aria-label={`第 ${post.post_number} 楼`}>
              #{post.post_number}
            </span>
          </div>
          {post.reply_to_post_number && (
            <a href={`#c-${post.reply_to_post_number}`}
              onClick={(event) => {
                event.preventDefault()
                document.getElementById(`c-${post.reply_to_post_number}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
              className="mb-1 block text-[11.5px] text-sub hover:text-ink">
              回复 {post.reply_to_user?.username || replyTarget?.username
                ? `@${post.reply_to_user?.username || replyTarget?.username} · ` : ''}第 {post.reply_to_post_number} 楼
            </a>
          )}
          <div
            className="post-body mt-1"
            dangerouslySetInnerHTML={{ __html: sanitizeCooked(post.cooked) }}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px] text-sub">
            <span>{timeAgo(post.created_at)}</span>
            <LikeButton postId={post.id} apiKey={session?.key} count={count} liked={liked} busy={busy} onToggle={toggle} />
            <button onClick={onReply} className="hover:text-ink">
              回复
            </button>
          </div>
          {error && <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-red-600">{error}</p>}
        </div>
      </div>
    </article>
  )
}

function ComposerBar({
  session,
  topicId,
  replyTo,
  onClearReplyTo,
  onRequireLogin,
  onCreated,
  commentCount,
  likeTarget,
  likeCount,
  onShare,
  shared,
  onJumpToComments,
  onExpandedChange,
}: {
  session: AuthSession | null
  topicId: number
  replyTo: { postNumber: number; username: string } | null
  onClearReplyTo: () => void
  onRequireLogin: () => void
  onCreated: (post: CreatedPost) => void
  commentCount: number
  likeTarget?: Post
  likeCount?: number
  onShare: () => void
  shared: string
  onJumpToComments: () => void
  onExpandedChange?: (expanded: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [attachments, setAttachments] = useState<{ id: string; preview: string; markdown: string; failed?: boolean }[]>([])
  const previewUrls = useRef(new Set<string>())
  const uploadBusyRef = useRef(false)
  const uploadGeneration = useRef(0)
  useEffect(() => () => {
    uploadGeneration.current += 1
    for (const url of previewUrls.current) URL.revokeObjectURL(url)
    previewUrls.current.clear()
  }, [])
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [liked, setLiked] = useState(Boolean(session) && postLiked(likeTarget))
  const [likeTotal, setLikeTotal] = useState(likeCount ?? 0)
  const postCountRef = useRef(likeTarget ? postLikeCount(likeTarget) : 0)
  useEffect(() => {
    const active = Boolean(session) && postLiked(likeTarget)
    setLiked(active)
    setLikeTotal(likeCount ?? 0)
    postCountRef.current = likeTarget ? postLikeCount(likeTarget) : 0
    if (session && likeTarget) publishTopicLike(session.username, topicId, active, likeCount ?? 0)
  }, [likeTarget, likeCount, session?.key, topicId])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (replyTo) setExpanded(true)
  }, [replyTo])

  useEffect(() => {
    onExpandedChange?.(expanded)
  }, [expanded, onExpandedChange])

  useEffect(() => {
    if (!session && expanded) setExpanded(false)
  }, [session, expanded])

  useEffect(() => {
    if (!expanded) return
    const timer = setTimeout(() => textareaRef.current?.focus(), 120)
    return () => clearTimeout(timer)
  }, [expanded])

  const insertAtCursor = (text: string) => {
    const element = textareaRef.current
    setRaw((prev) => {
      if (!element) return prev + text
      const start = element.selectionStart ?? prev.length
      const end = element.selectionEnd ?? prev.length
      const next = `${prev.slice(0, start)}${text}${prev.slice(end)}`
      requestAnimationFrame(() => {
        element.focus()
        const position = start + text.length
        element.setSelectionRange(position, position)
      })
      return next
    })
  }

  const uploadFiles = async (files: FileList | File[]) => {
    if (!session) {
      onRequireLogin()
      return
    }
    if (uploadBusyRef.current) return
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!images.length) return
    uploadBusyRef.current = true
    const generation = uploadGeneration.current
    setUploading(true)
    setError('')
    const pending = images.map((file) => {
      const preview = URL.createObjectURL(file)
      previewUrls.current.add(preview)
      return { file, id: crypto.randomUUID(), preview, markdown: '' }
    })
    setAttachments((prev) => [...prev, ...pending.map(({ file, ...item }) => item)])
    try {
      for (const item of pending) {
        try {
          const result = await uploadImage(session.key, item.file)
          if (generation !== uploadGeneration.current) return
          const url = result.short_url || result.url
          const name = (item.file.name || 'image').replace(/[()[\]\s]+/g, '-')
          setAttachments((prev) => prev.map((entry) => entry.id === item.id
            ? { ...entry, markdown: `![${name}](${url})` } : entry))
        } catch (err) {
          if (generation !== uploadGeneration.current) return
          setAttachments((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, failed: true } : entry))
          setError(errorMessage(err))
        }
      }
    } finally {
      if (generation === uploadGeneration.current) {
        uploadBusyRef.current = false
        setUploading(false)
      }
    }
  }

  const submit = async () => {
    const content = [raw.trim(), ...attachments.map((item) => item.markdown).filter(Boolean)].filter(Boolean).join('\n\n')
    if (!session || !content || busy || uploading || attachments.some((item) => item.failed)) return
    setBusy(true)
    setError('')
    try {
      const created = await replyToPost(session.key, {
        raw: content,
        topic_id: topicId,
        ...(replyTo ? { reply_to_post_number: replyTo.postNumber } : {}),
      })
      setDone('回复已发布')
      setRaw('')
      for (const url of previewUrls.current) URL.revokeObjectURL(url)
      previewUrls.current.clear()
      setAttachments([])
      setExpanded(false)
      setEmojiOpen(false)
      onCreated({ ...created,
        reply_to_post_number: created.reply_to_post_number ?? replyTo?.postNumber,
        reply_to_user: created.reply_to_user ?? (replyTo ? { username: replyTo.username } : undefined),
      })
      onClearReplyTo()
      setTimeout(() => setDone(''), 2500)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleLike = async () => {
    if (!session) {
      onRequireLogin()
      return
    }
    if (!likeTarget || busy) return
    setBusy(true)
    setError('')
    try {
      const result = liked
        ? await unlikePost(session.key, likeTarget.id)
        : await likePost(session.key, likeTarget.id)
      const nextLiked = result.actions_summary ? postLiked(result) : !liked
      const nextPostCount = result.actions_summary ? postLikeCount(result) : Math.max(0, postCountRef.current + (liked ? -1 : 1))
      const nextTotal = Math.max(0, likeTotal + nextPostCount - postCountRef.current)
      postCountRef.current = nextPostCount
      setLiked(nextLiked)
      setLikeTotal(nextTotal)
      publishTopicLike(session.username, topicId, nextLiked, nextTotal)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2 sm:px-5">
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-[240ms] ease-out ${
          expanded && session ? 'max-h-[460px] opacity-100' : 'pointer-events-none max-h-0 opacity-0'
        }`}
      >
        <div className="pb-2">
          {replyTo && (
            <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-sub">
              <span>
                回复 @{replyTo.username}（第 {replyTo.postNumber} 楼）
              </span>
              <button onClick={onClearReplyTo} className="hover:text-ink">
                取消
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.files || [])
              if (files.length) {
                event.preventDefault()
                void uploadFiles(files)
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) event.preventDefault()
            }}
            onDrop={(event) => {
              if (event.dataTransfer.files?.length) {
                event.preventDefault()
                void uploadFiles(event.dataTransfer.files)
              }
            }}
            rows={3}
            placeholder="写下你的评论，支持 Markdown、粘贴图片或拖入图片…"
            className="w-full resize-none rounded-xl border border-line bg-paper/60 px-3 py-2 text-[13px] leading-[1.65] text-ink outline-none focus:border-accent/40 focus:bg-surface"
          />

          {attachments.length > 0 && (
            <div className="mt-2 flex max-h-28 gap-2 overflow-x-auto py-1">
              {attachments.map((item) => (
                <div key={item.id} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-line">
                  <img src={item.preview} alt="待发送图片" className="h-full w-full object-cover" />
                  {!item.markdown && <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[10px] text-white">{item.failed ? '上传失败，请移除重试' : '上传中…'}</span>}
                  <button aria-label="移除图片" onClick={() => {
                    setAttachments((prev) => prev.filter((entry) => entry.id !== item.id))
                    URL.revokeObjectURL(item.preview)
                    previewUrls.current.delete(item.preview)
                  }} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white">
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-1">
            <button
              onClick={() => {
                if (!session) {
                  onRequireLogin()
                  return
                }
                fileRef.current?.click()
              }}
              title={session ? '上传图片' : '登录后可发图'}
              className="grid h-8 w-8 place-items-center rounded-full text-sub transition hover:bg-paper hover:text-ink"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void uploadFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <button
              onClick={() => setEmojiOpen((prev) => !prev)}
              title="插入表情"
              className={`grid h-8 w-8 place-items-center rounded-full transition hover:bg-paper hover:text-ink ${
                emojiOpen ? 'bg-paper text-ink' : 'text-sub'
              }`}
            >
              <EmojiIcon className="h-4 w-4" />
            </button>
            {uploading && <span className="ml-1 text-[11.5px] text-sub">图片上传中…</span>}

            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => {
                  setExpanded(false)
                  setEmojiOpen(false)
                  onClearReplyTo()
                }}
                className="px-3 py-1.5 text-[12px] text-sub hover:text-ink"
              >
                收起
              </button>
              <button
                onClick={submit}
                disabled={busy || uploading || attachments.some((item) => item.failed) || (!raw.trim() && !attachments.some((item) => item.markdown))}
                className="inline-flex items-center gap-1 rounded-full bg-accent-fill px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
              >
                <SendIcon className="h-3.5 w-3.5" />
                {busy ? '发布中…' : '发送'}
              </button>
            </div>
          </div>

          <EmojiPicker
            open={emojiOpen}
            onClose={() => setEmojiOpen(false)}
            onInsert={insertAtCursor}
          />
        </div>
      </div>

      {(error || done) && (
        <pre
          className={`mb-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg px-3 py-2 text-[11.5px] leading-relaxed ${
            error ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'
          }`}
        >
          {error || done}
        </pre>
      )}

      <div {...(expanded ? { inert: '' } : {})} aria-hidden={expanded}
        className={`grid transition-[grid-template-rows,opacity,transform] duration-[240ms] ease-out motion-reduce:transition-none ${expanded ? 'grid-rows-[0fr] translate-y-2 opacity-0 pointer-events-none' : 'grid-rows-[1fr] translate-y-0 opacity-100'}`}>
      <div className="min-h-0 overflow-hidden">
      <div className="flex items-center gap-2">
        <Avatar template={session?.avatarTemplate} size={28} name={session?.username} neutral={!session} />
        <button
          onClick={() => {
            if (!session) {
              onRequireLogin()
              return
            }
            setExpanded(true)
          }}
          className="min-w-0 flex-1 truncate rounded-full bg-paper px-3.5 py-2 text-left text-[12.5px] text-sub hover:bg-line/70"
        >
          {session ? (replyTo ? `回复 @${replyTo.username}…` : '说点什么…') : '登录后评论'}
        </button>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <LikeButton postId={likeTarget?.id} apiKey={session?.key} count={likeTotal} liked={liked} busy={busy} onToggle={toggleLike} large />
          <button
            onClick={onJumpToComments}
            aria-label="滚动到第一条评论"
            title="查看第一条评论"
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[12px] text-sub transition hover:text-ink"
          >
            <CommentIcon className="h-4 w-4" />
            {compactNumber(commentCount)}
          </button>
          <button
            onClick={onShare}
            title="复制官方原帖链接"
            aria-label={shared || '复制官方原帖链接'}
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[12px] text-sub hover:text-ink"
          >
            <ShareIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{shared || '分享'}</span>
          </button>
        </div>
      </div>
      </div>
      </div>
    </div>
  )
}

function goProfile(username?: string) {
  if (!username) return
  openUserCard(username)
}

function displayName(post?: Post) {
  if (!post) return ''
  return post.name?.trim() || post.display_username?.trim() || post.username
}

function extractImages(cooked: string, fallback?: string | null): string[] {
  const urls: string[] = []
  try {
    const doc = new DOMParser().parseFromString(cooked || '', 'text/html')
    doc.querySelectorAll('img').forEach((img) => {
      if ((img.className || '').includes('emoji')) return
      const src = img.getAttribute('src') || img.getAttribute('data-src')
      if (src) urls.push(absolutize(src))
    })
  } catch {
    // ignore
  }
  if (!urls.length && fallback) urls.push(absolutize(fallback))
  return [...new Set(urls)].slice(0, 20)
}
