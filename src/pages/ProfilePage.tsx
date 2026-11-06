import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Avatar from '../components/Avatar'
import ProfileEditor from '../components/ProfileEditor'
import { openUserCard } from '../lib/userCard'
import EmptyState from '../components/EmptyState'
import FeedCard from '../components/FeedCard'
import { BookmarkIcon, CommentIcon, HeartIcon, InfoIcon, UserIcon } from '../components/icons'
import { AUTH_EVENT, type AuthSession } from '../lib/auth'
import type { BookmarkItem, Category, Topic, ForumUser, UserActionItem, UserProfile } from '../types'
import {
  errorMessage,
  fetchBookmarks,
  fetchCategories,
  fetchCreatedTopics,
  fetchUserActions,
  fetchUserProfile,
  peekUserProfile,
  peekCreatedTopics,
} from '../api'
import { compactNumber, fullDate, sanitizeCooked, timeAgo } from '../lib/format'
import { profileErrorMessage, errorStatus as readErrorStatus } from '../lib/errors'

type Tab = 'notes' | 'likes' | 'bookmarks' | 'about'
type Status = 'idle' | 'loading' | 'error'

interface ProfilePageProps {
  username: string
  session: AuthSession | null
  onRequireLogin: () => void
  onOpenTopic: (topicId: number, postNumber?: number) => void
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'notes', label: '笔记' },
  { key: 'likes', label: '点赞' },
  { key: 'bookmarks', label: '收藏' },
  { key: 'about', label: '关于' },
]

const PAGE_SIZE = 20
const SECONDS_PER_DAY = 86400

export default function ProfilePage({ username, session, onRequireLogin, onOpenTopic }: ProfilePageProps) {
  const apiKey = session?.key ?? ''
  const isSelf = Boolean(session && session.username === username)

  const [editing, setEditing] = useState(false)
  const [savedNotice, setSavedNotice] = useState('')
  const [tab, setTab] = useState<Tab>('notes')
  const [reloadKey, setReloadKey] = useState(0)

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileStatus, setProfileStatus] = useState<Status>('loading')
  const [profileErrorStatus, setProfileErrorStatus] = useState<number | null>(null)
  const [categories, setCategories] = useState<Category[]>([])

  const [topics, setTopics] = useState<Topic[]>([])
  const [topicUsers, setTopicUsers] = useState<ForumUser[]>([])
  const [topicsStatus, setTopicsStatus] = useState<Status>('idle')
  const [topicsError, setTopicsError] = useState('')
  const [topicsErrorCode, setTopicsErrorCode] = useState<number | null>(null)
  const [hasMoreTopics, setHasMoreTopics] = useState(false)

  const [likes, setLikes] = useState<UserActionItem[]>([])
  const [likesStatus, setLikesStatus] = useState<Status>('idle')
  const [likesError, setLikesError] = useState('')
  const [likesErrorCode, setLikesErrorCode] = useState<number | null>(null)
  const [hasMoreLikes, setHasMoreLikes] = useState(false)

  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [bookmarksStatus, setBookmarksStatus] = useState<Status>('idle')
  const [bookmarksError, setBookmarksError] = useState('')
  const [bookmarksErrorCode, setBookmarksErrorCode] = useState<number | null>(null)
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false)

  const topicPageRef = useRef(0)
  const likesOffsetRef = useRef(0)
  const notesAbort = useRef<AbortController | null>(null)
  const likesAbort = useRef<AbortController | null>(null)
  const bookmarksAbort = useRef<AbortController | null>(null)

  const loadNotes = useCallback(
    async (page: number) => {
      if (!apiKey) return
      notesAbort.current?.abort()
      const controller = new AbortController()
      notesAbort.current = controller
      setTopicsStatus('loading')
      setTopicsError('')
      setTopicsErrorCode(null)
      try {
        const list = await fetchCreatedTopics(username, page, apiKey, controller.signal)
        if (controller.signal.aborted) return
        const fresh = (list.topics || []).filter(
          (topic) => topic.archetype !== 'private_message',
        )
        const perPage = list.per_page ?? 30
        setTopicUsers((prev) => {
          const users = new Map((page === 0 ? [] : prev).map((user) => [user.id, user]))
          for (const user of list.users || []) users.set(user.id, user)
          return [...users.values()]
        })
        setTopics((prev) => {
          const base = page === 0 ? [] : prev
          const seen = new Set(base.map((topic) => topic.id))
          return [...base, ...fresh.filter((topic) => !seen.has(topic.id))]
        })
        topicPageRef.current = page + 1
        setHasMoreTopics(list.more_topics_url === null ? false : Boolean(list.more_topics_url) || fresh.length >= perPage)
        setTopicsStatus('idle')
      } catch (err) {
        if (controller.signal.aborted) return
        setTopicsStatus('error')
        setTopicsError(errorMessage(err))
        setTopicsErrorCode(readErrorStatus(err))
      }
    },
    [apiKey, username],
  )

  const loadLikes = useCallback(async () => {
    if (!apiKey) return
    const offset = likesOffsetRef.current
    likesAbort.current?.abort()
    const controller = new AbortController()
    likesAbort.current = controller
    setLikesStatus('loading')
    setLikesError('')
    setLikesErrorCode(null)
    try {
      const items = await fetchUserActions(username, offset, apiKey, 1, controller.signal)
      if (controller.signal.aborted) return
      setLikes((prev) => {
        const base = offset === 0 ? [] : prev
        const seen = new Set(base.map((item) => `${item.topic_id}-${item.post_number ?? 0}`))
        return [
          ...base,
          ...items.filter((item) => !seen.has(`${item.topic_id}-${item.post_number ?? 0}`)),
        ]
      })
      likesOffsetRef.current = offset + PAGE_SIZE
      setHasMoreLikes(items.length >= PAGE_SIZE)
      setLikesStatus('idle')
    } catch (err) {
      if (controller.signal.aborted) return
      setLikesStatus('error')
      setLikesError(errorMessage(err))
      setLikesErrorCode(readErrorStatus(err))
    }
  }, [apiKey, username])

  const loadBookmarks = useCallback(async () => {
    if (!apiKey || !isSelf) return
    bookmarksAbort.current?.abort()
    const controller = new AbortController()
    bookmarksAbort.current = controller
    setBookmarksStatus('loading')
    setBookmarksError('')
    setBookmarksErrorCode(null)
    try {
      const items = await fetchBookmarks(username, apiKey, controller.signal)
      if (controller.signal.aborted) return
      setBookmarks(items)
      setBookmarksLoaded(true)
      setBookmarksStatus('idle')
    } catch (err) {
      if (controller.signal.aborted) return
      setBookmarksStatus('error')
      setBookmarksError(errorMessage(err))
      setBookmarksErrorCode(readErrorStatus(err))
    }
  }, [apiKey, isSelf, username])

  useEffect(() => {
    const changed = () => { if (isSelf) void loadBookmarks() }
    window.addEventListener('trae:bookmarks-changed', changed)
    return () => window.removeEventListener('trae:bookmarks-changed', changed)
  }, [loadBookmarks, isSelf])

  // 切换用户名 / 密钥 / 手动重试时整体重置，并重新拉取资料、分类与第一页笔记
  useEffect(() => {
    notesAbort.current?.abort()
    likesAbort.current?.abort()
    bookmarksAbort.current?.abort()
    notesAbort.current = null
    likesAbort.current = null
    bookmarksAbort.current = null

    topicPageRef.current = 0
    likesOffsetRef.current = 0

    const cachedProfile = apiKey ? peekUserProfile(username) : null
    setProfile(cachedProfile)
    setProfileStatus(cachedProfile ? 'idle' : apiKey ? 'loading' : 'idle')
    setProfileErrorStatus(null)
    const cachedTopics = apiKey ? peekCreatedTopics(username, 0, apiKey) : null
    setTopics((cachedTopics?.topics || []).filter((topic) => topic.archetype !== 'private_message'))
    setTopicUsers(cachedTopics?.users || [])
    setTopicsStatus('idle')
    setTopicsError('')
    setTopicsErrorCode(null)
    setHasMoreTopics(false)
    setLikes([])
    setLikesStatus('idle')
    setLikesError('')
    setLikesErrorCode(null)
    setHasMoreLikes(false)
    setBookmarks([])
    setBookmarksStatus('idle')
    setBookmarksError('')
    setBookmarksErrorCode(null)
    setBookmarksLoaded(false)

    if (!apiKey) return

    const controller = new AbortController()
    let alive = true

    fetchUserProfile(username, apiKey, controller.signal)
      .then((user) => {
        if (!alive) return
        setProfile(user)
        setProfileStatus('idle')
      })
      .catch((err: unknown) => {
        if (!alive) return
        // 有缓存时保留旧资料，仅后台刷新失败，不打断阅读
        if (cachedProfile) return
        setProfileStatus('error')
        const status = (err as { status?: number }).status
        setProfileErrorStatus(typeof status === 'number' ? status : null)
      })

    fetchCategories(controller.signal)
      .then((list) => {
        if (alive) setCategories(list)
      })
      .catch(() => {})

    void loadNotes(0)

    return () => {
      alive = false
      controller.abort()
      notesAbort.current?.abort()
      likesAbort.current?.abort()
      bookmarksAbort.current?.abort()
    }
  }, [apiKey, loadNotes, reloadKey, username])

  // 换到另一个用户的主页时回到「笔记」；重试时保留当前 Tab
  useEffect(() => {
    setTab('notes')
    setEditing(false)
    setSavedNotice('')
  }, [username])

  // 登录/退出后自动恢复：当前主页直接重新请求
  useEffect(() => {
    const onAuthChanged = () => setReloadKey((value) => value + 1)
    window.addEventListener(AUTH_EVENT, onAuthChanged)
    return () => window.removeEventListener(AUTH_EVENT, onAuthChanged)
  }, [])

  const selectTab = (next: Tab) => {
    setTab(next)
    if (next === 'likes' && likesStatus === 'idle' && likesOffsetRef.current === 0) {
      void loadLikes()
    }
    if (next === 'bookmarks' && isSelf && bookmarksStatus === 'idle' && !bookmarksLoaded) {
      void loadBookmarks()
    }
  }

  if (!session?.key) {
    return (
      <EmptyState
        icon={<UserIcon className="h-7 w-7" />}
        title="登录后查看完整主页"
        description="该站点对匿名访问隐藏了用户资料与动态；未登录不会发起任何请求。"
        onLogin={onRequireLogin}
      />
    )
  }

  if (profileStatus === 'error') {
    return (
      <div className="mx-auto w-full max-w-[980px] px-4 pb-24 pt-4 sm:pt-6">
        <div className="rounded-2xl bg-surface">
          <EmptyState
            icon={<UserIcon className="h-7 w-7" />}
            title={profileErrorMessage(profileErrorStatus)}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        </div>
      </div>
    )
  }

  const bio = profile ? profileBio(profile) : ''
  const joined = profile ? joinedDate(profile.created_at) : ''

  return (
    <div className="mx-auto w-full max-w-[980px] px-4 pb-20 pt-4 sm:pt-6">
      {!profile ? (
        <ProfileSkeleton />
      ) : (
        <>
          <header className="rounded-2xl bg-surface p-6">
            <div className="flex flex-wrap items-start gap-5">
              <Avatar
                template={profile.avatar_template}
                name={profile.name || profile.username}
                size={96}
              />
              <div className="min-w-[120px] flex-1">
                <h1 className="break-words text-[18px] font-semibold leading-tight text-ink">
                  {profile.name || profile.username}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-sub">
                  <span className="break-all">@{profile.username}</span>
                  {joined && (
                    <>
                      <span>·</span>
                      <span>加入于 {joined}</span>
                    </>
                  )}
                  {typeof profile.trust_level === 'number' && (
                    <>
                      <span>·</span>
                      <span>TL{profile.trust_level}</span>
                    </>
                  )}
                  {profile.admin && (
                    <>
                      <span>·</span>
                      <span className="rounded bg-soft px-1.5 py-0.5 font-medium text-accent">
                        管理员
                      </span>
                    </>
                  )}
                  {profile.moderator && (
                    <>
                      <span>·</span>
                      <span className="rounded bg-info/10 px-1.5 py-0.5 font-medium text-info">
                        版主
                      </span>
                    </>
                  )}
                </div>
                {profile.title && <p className="mt-2 text-sm text-sub">{profile.title}</p>}
                {profile.location && <p className="mt-1 text-xs text-sub">{profile.location}</p>}
                {bio && (
                  <p className="mt-3 line-clamp-2 whitespace-pre-line break-words text-[13px] leading-relaxed text-ink/70">
                    {bio}
                  </p>
                )}
              </div>
              <div className="ml-auto flex shrink-0 gap-2 sm:flex-col">
                {isSelf ? <button onClick={() => { setEditing(true); setSavedNotice('') }} className="rounded-full border border-line px-4 py-2 text-sm text-ink hover:bg-soft">修改资料</button> : <>
                  <button disabled={profile.can_send_private_message_to_user === false} title={profile.can_send_private_message_to_user === false ? '当前账号无法向此用户发送私信' : '发送私信'} onClick={() => openUserCard(profile.username, 'private')} className="rounded-full bg-accent-fill px-5 py-2 text-sm text-white disabled:opacity-40">私信</button>
                  <button onClick={() => openUserCard(profile.username, 'chat')} className="rounded-full border border-line px-5 py-2 text-sm text-ink hover:bg-soft">聊天</button>
                </>}
              </div>
            </div>
            {savedNotice && <p role="status" className="mt-3 text-sm text-sub">{savedNotice}</p>}
            {profile.featured_topic && <a href={`#/topic/${profile.featured_topic.id}`} className="mt-4 block rounded-lg bg-soft px-3 py-2 text-sm text-ink">精选话题：{profile.featured_topic.title}</a>}
            {editing && isSelf && <ProfileEditor key={session.username} user={profile} session={session} onClose={() => setEditing(false)} onSaved={(fresh) => {
              setProfile(fresh)
              setSavedNotice('资料已更新')
              if (fresh.username !== username && window.location.hash.startsWith('#/u/')) window.location.hash = `/u/${encodeURIComponent(fresh.username)}`
            }} />}
            <Metrics user={profile} />
          </header>

          <div className="sticky top-14 z-20 mt-4 bg-paper/95 pb-1 backdrop-blur">
            <div className="no-scrollbar flex items-center gap-1 overflow-x-auto pt-2">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => selectTab(item.key)}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] transition ${
                    tab === item.key
                      ? 'bg-surface font-semibold text-[#ff2442] ring-1 ring-line'
                      : 'text-sub hover:bg-surface/70 hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 min-w-0">
            {tab === 'notes' && (
              <div>
                {topicsStatus === 'loading' && topics.length === 0 && (
                  <div className="masonry columns-2 lg:columns-3">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="overflow-hidden rounded-lg bg-surface">
                        <div className="aspect-[4/3] w-full animate-pulse bg-line/70" />
                      </div>
                    ))}
                  </div>
                )}

                {topics.length > 0 && (
                  <div className="masonry columns-2 lg:columns-3">
                    {topics.map((topic) => (
                      <FeedCard
                        key={topic.id}
                        topic={topic}
                        users={topicUsers}
                        category={
                          topic.category_id != null
                            ? categories.find((category) => category.id === topic.category_id)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}

                {topicsStatus === 'error' && (
                  <div className="mt-3">
                    <ErrorPanel
                      status={topicsErrorCode}
                      raw={topicsError}
                      onRetry={() => void loadNotes(topicPageRef.current)}
                    />
                  </div>
                )}

                {topicsStatus === 'idle' && topics.length === 0 && (
                  <EmptyPanel icon={<CommentIcon className="h-8 w-8" />} text="还没有发布笔记" />
                )}

                {topics.length > 0 && (
                  <div className="mt-3 text-center">
                    {hasMoreTopics ? (
                      <button
                        type="button"
                        onClick={() => void loadNotes(topicPageRef.current)}
                        disabled={topicsStatus === 'loading'}
                        className="rounded-full border border-line bg-surface px-4 py-1.5 text-[12px] text-sub transition hover:border-[#ff2442] hover:text-[#ff2442] disabled:opacity-60"
                      >
                        {topicsStatus === 'loading' ? '正在加载…' : '加载更多'}
                      </button>
                    ) : (
                      <p className="text-[12px] text-sub/80">没有更多了</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'likes' && (
              <div>
                {likesStatus === 'loading' && likes.length === 0 && (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="h-24 animate-pulse rounded-2xl bg-surface" />
                    ))}
                  </div>
                )}

                {likesStatus === 'error' && (
                  <ErrorPanel status={likesErrorCode} raw={likesError} onRetry={() => void loadLikes()} />
                )}

                {likesStatus === 'idle' && likes.length === 0 && (
                  <EmptyPanel icon={<HeartIcon className="h-8 w-8" />} text="还没有点赞过内容" />
                )}

                {likes.length > 0 && (
                  <div className="space-y-2">
                    {likes.map((item, index) => (
                      <ActionRow
                        key={`${item.topic_id}-${item.post_number ?? 0}-${index}`}
                        title={item.title || '未命名话题'}
                        excerpt={excerptText(item.excerpt)}
                        meta={timeAgo(item.created_at)}
                        onClick={() => onOpenTopic(item.topic_id, item.post_number ?? undefined)}
                      />
                    ))}
                  </div>
                )}

                {likes.length > 0 && hasMoreLikes && (
                  <div className="mt-3 text-center">
                    <button
                      type="button"
                      onClick={() => void loadLikes()}
                      disabled={likesStatus === 'loading'}
                      className="rounded-full border border-line bg-surface px-4 py-1.5 text-[12px] text-sub transition hover:border-[#ff2442] hover:text-[#ff2442] disabled:opacity-60"
                    >
                      {likesStatus === 'loading' ? '正在加载…' : '加载更多'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'bookmarks' &&
              (isSelf ? (
                <div>
                  {bookmarksStatus === 'loading' && bookmarks.length === 0 && (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="h-16 animate-pulse rounded-2xl bg-surface" />
                      ))}
                    </div>
                  )}

                  {bookmarksStatus === 'error' && (
                    <ErrorPanel
                      status={bookmarksErrorCode}
                      raw={bookmarksError}
                      onRetry={() => void loadBookmarks()}
                    />
                  )}

                  {bookmarksLoaded && bookmarks.length === 0 && (
                    <EmptyPanel icon={<BookmarkIcon className="h-8 w-8" />} text="还没有收藏" />
                  )}

                  {bookmarks.length > 0 && (
                    <div className="space-y-2">
                      {bookmarks.map((item, index) => (
                        <ActionRow
                          key={`${item.topic_id}-${item.post_number ?? 0}-${index}`}
                          title={item.title || '未命名话题'}
                          meta={timeAgo(item.created_at)}
                          onClick={() => onOpenTopic(item.topic_id, item.post_number ?? undefined)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={<BookmarkIcon className="h-6 w-6" />}
                  title="收藏仅自己可见"
                  description="查看他人的收藏需要本人登录，当前账号无权访问。"
                  compact
                />
              ))}

            {tab === 'about' && (
              <div className="rounded-2xl bg-surface p-6">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                  <InfoIcon className="h-4 w-4 text-[#ff2442]" />
                  关于 {profile.name || profile.username}
                </div>
                <dl className="mt-3">
                  <InfoRow label="头衔" value={profile.title || '—'} />
                  <InfoRow label="地点" value={profile.location || '—'} />
                  <InfoRow label="个人简介" value={bio || '—'} />
                  <InfoRow label="加入时间" value={fullDate(profile.created_at) || '—'} />
                  <InfoRow
                    label="最后活跃"
                    value={fullDate(profile.last_seen_at ?? undefined) || '—'}
                  />
                  <InfoRow
                    label="信任等级"
                    value={
                      typeof profile.trust_level === 'number' ? `TL${profile.trust_level}` : '—'
                    }
                  />
                  <InfoRow
                    label="帖子"
                    value={
                      typeof profile.post_count === 'number'
                        ? compactNumber(profile.post_count)
                        : '—'
                    }
                  />
                  <InfoRow
                    label="主题"
                    value={
                      typeof profile.topic_count === 'number'
                        ? compactNumber(profile.topic_count)
                        : '—'
                    }
                  />
                  <InfoRow
                    label="获赞"
                    value={
                      typeof profile.likes_received === 'number'
                        ? compactNumber(profile.likes_received)
                        : '—'
                    }
                  />
                </dl>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function joinedDate(input?: string): string {
  return fullDate(input).split(' ')[0] || ''
}

function profileBio(user: UserProfile): string {
  const raw = (user.bio_raw || '').trim()
  if (raw) return raw
  return excerptText(user.bio_excerpt)
}

function excerptText(input?: string | null): string {
  if (!input) return ''
  try {
    const doc = new DOMParser().parseFromString(sanitizeCooked(input), 'text/html')
    doc.querySelectorAll('.img-box, img, .lightbox-wrapper').forEach((node) => node.remove())
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  } catch {
    return input
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

function Metrics({ user }: { user: UserProfile }) {
  const metrics: { label: string; value: string }[] = []
  if (typeof user.post_count === 'number') {
    metrics.push({ label: '帖子', value: compactNumber(user.post_count) })
  }
  if (typeof user.topic_count === 'number') {
    metrics.push({ label: '主题', value: compactNumber(user.topic_count) })
  }
  if (typeof user.likes_received === 'number') {
    metrics.push({ label: '获赞', value: compactNumber(user.likes_received) })
  }
  if (typeof user.time_read === 'number') {
    metrics.push({ label: '阅读', value: `${(user.time_read / SECONDS_PER_DAY).toFixed(1)} 天` })
  }

  if (!metrics.length) return null

  return (
    <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-line pt-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-[68px]">
          <p className="text-[15px] font-semibold leading-none text-ink">{metric.value}</p>
          <p className="mt-1.5 text-[12px] text-sub">{metric.label}</p>
        </div>
      ))}
    </div>
  )
}

function ActionRow({
  title,
  excerpt,
  meta,
  onClick,
}: {
  title: string
  excerpt?: string
  meta?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-2xl bg-surface px-4 py-3.5 text-left transition hover:bg-paper"
    >
      <p className="line-clamp-1 break-words text-[13.5px] font-medium text-ink">{title}</p>
      {excerpt && (
        <p className="mt-1 line-clamp-2 break-words text-[12.5px] leading-relaxed text-sub">
          {excerpt}
        </p>
      )}
      {meta && <p className="mt-1.5 text-[11.5px] text-sub/80">{meta}</p>}
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 border-b border-line/70 py-2.5 last:border-0">
      <dt className="w-[68px] shrink-0 text-[12.5px] text-sub">{label}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
        {value}
      </dd>
    </div>
  )
}

function EmptyPanel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="rounded-2xl bg-surface px-6 py-14 text-center">
      <div className="flex justify-center text-sub/50">{icon}</div>
      <p className="mt-3 text-[13px] text-sub">{text}</p>
    </div>
  )
}

function ErrorPanel({
  status,
  raw,
  onRetry,
}: {
  status: number | null
  raw?: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-2xl bg-surface">
      <EmptyState
        icon={<InfoIcon className="h-6 w-6" />}
        title={status === 429 ? '请求较频繁，请稍后重试' : status === 401 || status === 403 || status === 404 ? profileErrorMessage(status) : raw?.includes('超时') ? '加载超时，请重试' : '暂时无法加载，请重试'}
        onRetry={onRetry}
        compact
      />
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="rounded-2xl bg-surface p-6">
      <div className="flex items-start gap-5">
        <div className="h-24 w-24 shrink-0 animate-pulse rounded-full bg-paper" />
        <div className="min-w-0 flex-1 space-y-3 pt-1">
          <div className="h-5 w-32 animate-pulse rounded bg-paper" />
          <div className="h-3.5 w-48 max-w-full animate-pulse rounded bg-paper" />
          <div className="h-3.5 w-full max-w-sm animate-pulse rounded bg-paper" />
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-paper" />
        </div>
      </div>
      <div className="mt-5 flex gap-8 border-t border-line pt-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <div className="h-4 w-10 animate-pulse rounded bg-paper" />
            <div className="h-3 w-8 animate-pulse rounded bg-paper" />
          </div>
        ))}
      </div>
    </div>
  )
}
