import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Avatar from '../components/Avatar'
import { notificationDetails } from '../lib/notificationDetails'
import EmptyState from '../components/EmptyState'
import RateLimitState from '../components/RateLimitState'
import { BackIcon, BellIcon, HeartIcon, MailIcon } from '../components/icons'
import { fetchNotifications, fetchTopicPostsByIds, fetchUserProfile, peekNotifications } from '../api'
import { timeAgo } from '../lib/format'
import { privateErrorMessage, errorStatus as readErrorStatus } from '../lib/errors'
import { AUTH_EVENT, type AuthSession } from '../lib/auth'
import type { NotificationItem } from '../types'

const READ_STORAGE_KEY = 'trae-lite.notif-read.v1'
const READ_LIMIT = 200
const NOTIFICATION_LIMIT = 40

/**
 * 是否还有下一页：
 * 该站点的 load_more_notifications 到底后仍返回 URL，因此还要看本页是否取满、
 * 以及已取条数是否达到 total_rows_notifications。
 */
function hasNextPage(
  pageLength: number,
  offset: number,
  fetched: number,
  total: number | undefined,
  loadMore: string | null | undefined,
): boolean {
  if (!pageLength || pageLength < NOTIFICATION_LIMIT) return false
  if (typeof total === 'number' && fetched >= total) return false
  if (typeof total === 'number' && offset + pageLength >= total) return false
  return Boolean(loadMore)
}
/** 每次进入通知页最多补 8 个头像，其余用字母头像，控制上游请求量 */
const AVATAR_LIMIT = 8
/** 整个会话期间头像补全的总预算，用完后统一回退字母头像 */
let avatarBudget = 12
/** 头像补全并发压到 2：一次性抓 8 个头像会撞上游限流（429） */
const AVATAR_CONCURRENCY = 2
/** 两次头像请求之间的间隔，避免连续突发 */
const AVATAR_GAP_MS = 200
/** 失败后 60 秒内不再重试，回退字母头像 */
const AVATAR_RETRY_MS = 60_000

/** 模块级头像模板缓存，避免每次进入通知页重复请求同一批用户 */
const avatarTemplateCache = new Map<string, string>()
const avatarFailedAt = new Map<string, number>()

/** 点赞类型：5 = 赞，25 = 表情回应；两者数据结构一致，判定规则相同 */
const LIKE_TYPES = new Set([5, 25])

/**
 *  Discourse 通知类型约定（实测确认）：
 *  6 = private_message（别人给你发私信）
 *  7 = invited_to_private_message（你被拉进私信）
 */
const ACTION_LABELS: Record<number, string> = {
  1: '在帖子里提到了你',
  2: '回复了你的帖子',
  3: '引用了你的回复',
  4: '编辑了帖子',
  8: '接受了你的邀请',
  9: '发布了新回复',
  10: '移动了帖子',
  11: '链接了你的帖子',
  13: '邀请你加入话题',
  15: '提及了你所在的群组',
  17: '发布了新话题',
  18: '话题提醒',
  20: '帖子已获批准',
  24: '收藏提醒',
  36: '关注的分类或标签有新话题',
  5: '赞了你的帖子',
  6: '发来一条私信',
  7: '邀请你加入私信',
  25: '赞了你的帖子',
}

/** 被赞楼层的正文摘要，按 post_id 缓存（模块级，切页不重复请求） */
interface LikedPostInfo {
  postNumber: number
  isFirstPost: boolean
  excerpt: string
}
const likedPostCache = new Map<number, LikedPostInfo | null>()

const TABS = [
  { key: 'mentions', label: '评论和@', icon: BackIcon },
  { key: 'likes', label: '赞和收藏', icon: HeartIcon },
] as const

type NotificationTab = (typeof TABS)[number]['key']

/** 图标按动作类型区分：点赞=爱心，回复/引用=回箭头，私信=信封，其他=铃铛 */
function notificationIcon(type: number): { Icon: typeof HeartIcon; color: string } {
  if (LIKE_TYPES.has(type)) return { Icon: HeartIcon, color: 'text-[#ff2442]' }
  if (type === 2 || type === 3) return { Icon: BackIcon, color: 'text-[#3b82f6]' }
  if (type === 6 || type === 7) return { Icon: MailIcon, color: 'text-[#8b5cf6]' }
  return { Icon: BellIcon, color: 'text-sub' }
}

interface NotificationsPageProps {
  session: AuthSession | null
  onRequireLogin: () => void
  onOpenTopic: (topicId: number, postNumber?: number, replyMode?: boolean) => void
  onUnread?: (count: number) => void
}

function readStoredIds(): Set<number> {
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    const ids = parsed
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
      .slice(-READ_LIMIT)
    return new Set(ids)
  } catch {
    return new Set()
  }
}

function isLike(item: NotificationItem): boolean {
  return LIKE_TYPES.has(item.notification_type)
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** 被赞楼层的 post_id：data.original_post_id 实测存在 */
function likePostId(item: NotificationItem): number | null {
  return positiveInt(item.data?.original_post_id)
}

/** 被赞楼层序号：实测顶层 post_number 与 data.post_number 均可能携带 */
function likePostNumber(item: NotificationItem): number | null {
  return positiveInt(item.data?.post_number) ?? positiveInt(item.post_number)
}

/**
 * 点赞合并键：(type, topic_id, 被赞楼层)。
 * 同一帖子的不同楼层各自成组，绝不跨楼层合并。
 */
function likeGroupKey(item: NotificationItem): string {
  return [
    'like',
    item.notification_type,
    item.topic_id ?? '',
    likePostId(item) ?? likePostNumber(item) ?? item.id,
  ].join('|')
}

function notificationUsername(item: NotificationItem): string {
  // 群组收件箱（type 16）的 data.username 是接收人自己，发起方是 group_name；
  // 其余类型一律取动作发起人字段，绝不回退到话题作者。
  if (item.notification_type === 16) return item.data?.group_name || ''
  return item.data?.display_username || item.data?.username1 || ''
}

/**
 * 轮询可能重复下发同一条通知，这里只按通知 id 去重。
 * 不能按 (type, topic_id, post_id) 去重：同一楼层不同人的点赞是不同通知，需要保留以做合并。
 */
function notificationKey(item: NotificationItem): string {
  return String(item.id)
}

/** 通知摘要 / 楼层正文可能是纯文本，也可能带 HTML，统一转成纯文本（渲染时由 React 转义） */
function htmlToText(html: unknown, limit = 140): string {
  const raw = String(html || '')
  if (!raw) return ''
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  // 图片灯箱的尺寸/文件名噪音与脚本节点直接丢弃
  doc
    .querySelectorAll(
      'script,style,iframe,object,embed,form,input,button,textarea,.meta,.filename,.informations',
    )
    .forEach((node) => node.remove())
  const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function summaryText(item: NotificationItem): string {
  return htmlToText(item.data?.topic_title || item.data?.excerpt || item.data?.message)
}

function createdTimestamp(item: NotificationItem): number {
  const ts = Date.parse(item.created_at)
  return Number.isFinite(ts) ? ts : 0
}

/** 展示行：同一楼层点赞的 1..N 条通知合并为一行 */
interface NotificationRow {
  key: string
  /** 合并组内全部通知 id，用于整体标记已读 */
  ids: number[]
  /** 组内最新一条通知，用于打开楼层与图标类型 */
  item: NotificationItem
  createdAt: string
  time: number
  unread: boolean
  /** 发起人展示：1 人「A」、2–3 人「A、B」、>3 人「A 等 4 人」 */
  displayName: string
  /** 头像取首位发起人 */
  avatarName: string
  label: string
  summary: string
  topicId: number | null
  postNumber?: number
}

export default function NotificationsPage({
  session,
  onRequireLogin,
  onOpenTopic,
  onUnread,
}: NotificationsPageProps) {
  const apiKey = session?.key || ''
  const [tab, setTab] = useState<NotificationTab>('mentions')
  const [items, setItems] = useState<NotificationItem[]>([])
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const [errorCode, setErrorCode] = useState<number | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [readIds, setReadIds] = useState<Set<number>>(() => readStoredIds())
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({})
  const [hasMore, setHasMore] = useState(false)
  const [moreStatus, setMoreStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [totalRows, setTotalRows] = useState<number | null>(null)
  const offsetRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const generationRef = useRef(0)
  const initialPromiseRef = useRef<Promise<unknown> | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [likedPosts, setLikedPosts] = useState<Record<number, LikedPostInfo | null>>(() => {
    const seed: Record<number, LikedPostInfo | null> = {}
    likedPostCache.forEach((info, postId) => {
      seed[postId] = info
    })
    return seed
  })
  const readIdsRef = useRef(readIds)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    readIdsRef.current = readIds
  }, [readIds])

  useEffect(() => {
    if (!apiKey) {
      setItems([])
      setStatus('idle')
      setErrorCode(null)
      return
    }

    const controller = new AbortController()
    let alive = true
    generationRef.current += 1
    const generation = generationRef.current
    loadingMoreRef.current = false
    offsetRef.current = 0
    setErrorCode(null)
    setMoreStatus('idle')

    // 缓存优先：先用上次的通知立即渲染，网络结果回来后替换
    const cached = peekNotifications(apiKey, NOTIFICATION_LIMIT)
    if (cached) {
      const list = Array.isArray(cached.notifications) ? cached.notifications : []
      setItems(list)
      offsetRef.current = list.length
      setHasMore(
        hasNextPage(
          list.length,
          0,
          list.length,
          cached.total_rows_notifications,
          cached.load_more_notifications,
        ),
      )
      if (typeof cached.total_rows_notifications === 'number') {
        setTotalRows(cached.total_rows_notifications)
      }
      setStatus('idle')
    } else {
      setStatus('loading')
      setItems([])
      setHasMore(false)
      setTotalRows(null)
    }

    const request = fetchNotifications(apiKey, NOTIFICATION_LIMIT, 0, controller.signal)
      .then((data) => {
        if (!alive || generation !== generationRef.current) return
        const list = Array.isArray(data.notifications) ? data.notifications : []
        setItems(list)
        offsetRef.current = list.length
        setHasMore(hasNextPage(list.length, 0, list.length, data.total_rows_notifications, data.load_more_notifications))
        if (typeof data.total_rows_notifications === 'number') {
          setTotalRows(data.total_rows_notifications)
        }
        setStatus('idle')
      })
      .catch((err) => {
        if (!alive || controller.signal.aborted) return
        // 读失败已在请求层静默重试；已有缓存内容时保留列表，不打断阅读
        setStatus(cached ? 'idle' : 'error')
        setErrorCode(readErrorStatus(err))
      })
      .finally(() => {
        if (initialPromiseRef.current === request) initialPromiseRef.current = null
      })
    initialPromiseRef.current = request

    return () => {
      alive = false
      controller.abort()
    }
  }, [apiKey, reloadToken])

  useEffect(() => {
    const onAuthChanged = () => setReloadToken((value) => value + 1)
    window.addEventListener(AUTH_EVENT, onAuthChanged)
    return () => window.removeEventListener(AUTH_EVENT, onAuthChanged)
  }, [])

  useEffect(() => {
    if (!apiKey || !items.length) return

    const usernames = Array.from(
      new Set(items.map(notificationUsername).filter((name) => name.length > 0)),
    )
    const pending = usernames
      .filter((name) => {
        if (avatarTemplateCache.has(name)) return false
        const failedAt = avatarFailedAt.get(name)
        return !failedAt || Date.now() - failedAt > AVATAR_RETRY_MS
      })
      .slice(0, Math.min(AVATAR_LIMIT, avatarBudget))
    if (!pending.length) return

    const controller = new AbortController()
    let cancelled = false
    let cursor = 0

    const worker = async () => {
      while (!cancelled && cursor < pending.length) {
        const username = pending[cursor]
        cursor += 1
        avatarBudget = Math.max(0, avatarBudget - 1)
        try {
          const user = await fetchUserProfile(username, apiKey, controller.signal)
          if (cancelled) return
          const template = user.avatar_template || ''
          avatarTemplateCache.set(username, template)
          if (template) {
            setAvatarMap((prev) =>
              prev[username] === template ? prev : { ...prev, [username]: template },
            )
          }
        } catch {
          // 头像加载失败静默处理，回退到字母头像；短时间内不再重复请求
          avatarFailedAt.set(username, Date.now())
        } finally {
          if (!cancelled) await new Promise((resolve) => setTimeout(resolve, AVATAR_GAP_MS))
        }
      }
    }

    const workers = Math.min(AVATAR_CONCURRENCY, pending.length)
    for (let i = 0; i < workers; i += 1) void worker()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [items, apiKey])

  /**
   * 点赞摘要：按 topic 批量取被赞楼层的正文片段（一次请求可覆盖同帖多个楼层），
   * 结果按 post_id 缓存；请求失败记为 null，回退到主题标题，避免重复请求。
   */
  useEffect(() => {
    if (!items.length) return

    const pending = new Map<number, number[]>()
    for (const item of items) {
      if (!isLike(item)) continue
      const topicId = item.topic_id
      const postId = likePostId(item)
      if (typeof topicId !== 'number' || topicId <= 0 || postId === null) continue
      if (likedPostCache.has(postId)) continue
      const ids = pending.get(topicId) ?? []
      if (!ids.includes(postId)) ids.push(postId)
      pending.set(topicId, ids)
    }
    if (!pending.size) return

    const controller = new AbortController()
    let cancelled = false

    const run = async () => {
      for (const [topicId, postIds] of pending) {
        if (cancelled) return
        try {
          const data = await fetchTopicPostsByIds(topicId, postIds, controller.signal)
          if (cancelled) return
          const posts = data.post_stream?.posts ?? []
          const next: Record<number, LikedPostInfo | null> = {}
          for (const postId of postIds) {
            const post = posts.find((entry) => entry.id === postId)
            if (!post) {
              likedPostCache.set(postId, null)
              next[postId] = null
              continue
            }
            const info: LikedPostInfo = {
              postNumber: post.post_number,
              isFirstPost: post.post_number === 1,
              excerpt: htmlToText(post.cooked),
            }
            likedPostCache.set(postId, info)
            next[postId] = info
          }
          setLikedPosts((prev) => ({ ...prev, ...next }))
        } catch {
          if (cancelled) return
          const failed: Record<number, LikedPostInfo | null> = {}
          for (const postId of postIds) {
            likedPostCache.set(postId, null)
            failed[postId] = null
          }
          setLikedPosts((prev) => ({ ...prev, ...failed }))
        }
      }
    }

    void run()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [items])

  const uniqueItems = useMemo(() => {
    const seen = new Set<string>()
    return items.filter((item) => {
      const key = notificationKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [items])

  const rows = useMemo(() => {
    const groups = new Map<string, NotificationItem[]>()
    for (const item of uniqueItems) {
      const key = isLike(item) ? likeGroupKey(item) : `single|${item.notification_type}|${item.id}`
      const list = groups.get(key)
      if (list) list.push(item)
      else groups.set(key, [item])
    }

    const out: NotificationRow[] = []
    for (const [key, groupItems] of groups) {
      // 组内最新一条用于时间与打开楼层；发起人按时序排列
      const latest = groupItems.reduce((a, b) =>
        createdTimestamp(b) > createdTimestamp(a) ? b : a,
      )
      const chronological = [...groupItems].sort(
        (a, b) => createdTimestamp(a) - createdTimestamp(b),
      )
      const names: string[] = []
      for (const item of chronological) {
        const name = notificationUsername(item)
        if (name && !names.includes(name)) names.push(name)
      }

      const topicId = notificationDetails(latest, session?.username || '').topicId || null
      const unread = groupItems.some((item) => !item.read && !readIds.has(item.id))
      let postNumber = latest.post_number
      let label: string
      let summary: string

      if (isLike(latest)) {
        // 被赞楼层判定：post_number === 1 才是主题首帖，其余一律是回复
        const postId = groupItems.reduce<number | null>(
          (found, item) => found ?? likePostId(item),
          null,
        )
        const info = postId !== null ? likedPosts[postId] : undefined
        postNumber = info?.postNumber ?? likePostNumber(latest) ?? postNumber
        label = postNumber === 1 ? '赞了你的帖子' : '赞了你的回复'
        // 摘要展示被赞楼层的正文片段；确实取不到时才回退主题标题
        summary =
          info?.excerpt || (info === null || postId === null || topicId === null ? summaryText(latest) : '')
      } else {
        label = ACTION_LABELS[latest.notification_type] || '有新动态'
        summary = summaryText(latest)
      }

      const details = notificationDetails(latest, session?.username || '')
      if (details.label) label = details.label
      if (!summary) summary = details.summary || (!topicId ? '点击前往官方论坛查看通知详情' : '')
      const primary = details.label ? details.name : names[0] || details.name
      const displayName = details.label ? details.name :
        names.length > 3
          ? `${primary} 等 ${names.length} 人`
          : names.length
            ? names.join('、')
            : primary

      out.push({
        key,
        ids: groupItems.map((item) => item.id),
        item: latest,
        createdAt: latest.created_at,
        time: createdTimestamp(latest),
        unread,
        displayName,
        avatarName: primary,
        label,
        summary,
        topicId,
        postNumber,
      })
    }

    return out.sort((a, b) => b.time - a.time)
  }, [uniqueItems, likedPosts, readIds])

  const visible = useMemo(
    () => rows.filter((row) => (tab === 'likes' ? isLike(row.item) : !isLike(row.item))),
    [rows, tab],
  )

  const unreadCount = useMemo(() => rows.filter((row) => row.unread).length, [rows])

  useEffect(() => {
    if (!apiKey || status !== 'idle') return
    onUnread?.(unreadCount)
  }, [apiKey, status, unreadCount, onUnread])

  /** 串行加载下一页：offset 只有成功后才推进，失败保持原值便于重试同一页 */
  const loadMore = useCallback(async () => {
    if (!apiKey || !hasMore || loadingMoreRef.current) return
    loadingMoreRef.current = true
    // 缓存先渲染时，首屏请求可能还在路上：等它落地再取下一页，避免并发抢同一个 offset
    if (initialPromiseRef.current) {
      try {
        await initialPromiseRef.current
      } catch {
        // 首屏失败时由首屏逻辑呈现，这里继续尝试下一页
      }
    }
    const generation = generationRef.current
    const currentOffset = offsetRef.current
    setMoreStatus('loading')
    try {
      const data = await fetchNotifications(apiKey, NOTIFICATION_LIMIT, currentOffset)
      if (!mountedRef.current || generation !== generationRef.current) return
      const next = Array.isArray(data.notifications) ? data.notifications : []
      if (!next.length) {
        // 返回空页视为到底，避免补偿逻辑空转
        setHasMore(false)
        setMoreStatus('idle')
        return
      }
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id))
        return [...prev, ...next.filter((item) => !seen.has(item.id))]
      })
      offsetRef.current = currentOffset + next.length
      setHasMore(
        hasNextPage(
          next.length,
          currentOffset,
          currentOffset + next.length,
          data.total_rows_notifications,
          data.load_more_notifications,
        ),
      )
      if (typeof data.total_rows_notifications === 'number') {
        setTotalRows(data.total_rows_notifications)
      }
      setMoreStatus('idle')
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      // offset 不推进：点「重新加载」重取同一页
      setMoreStatus('error')
    } finally {
      loadingMoreRef.current = false
    }
  }, [apiKey, hasMore])

  // 滚到底 / sentinel 进入视口时取下一页；失败后不再自动重试，交给底部「重新加载」
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore || status !== 'idle' || moreStatus !== 'idle') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { rootMargin: '200px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, status, moreStatus, loadMore])

  // 过滤补偿：当前 Tab 不足 10 行仍有下一页时继续取，直到凑满或到底
  useEffect(() => {
    if (status !== 'idle' || !hasMore || moreStatus !== 'idle') return
    if (visible.length >= 10) return
    void loadMore()
  }, [status, hasMore, moreStatus, visible.length, loadMore])

  const markRead = (ids: number[]) => {
    if (ids.every((id) => readIdsRef.current.has(id))) return
    const next = new Set(readIdsRef.current)
    ids.forEach((id) => next.add(id))
    const trimmed = Array.from(next).slice(-READ_LIMIT)
    readIdsRef.current = new Set(trimmed)
    setReadIds(new Set(trimmed))
    try {
      localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(trimmed))
    } catch {
      // 本地存储不可用时仅保留内存状态
    }
  }

  const handleOpen = (row: NotificationRow) => {
    markRead(row.ids)
    if (row.topicId) onOpenTopic(row.topicId, row.postNumber)
    else window.open(notificationDetails(row.item, session?.username || '').href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 pb-24 pt-4 sm:pt-6">
      <div className="overflow-hidden rounded-xl border border-line/60 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-4 py-4 sm:px-5">
          <h1 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
            <BellIcon className="h-4 w-4" />
            通知
          </h1>
          <div className="inline-flex items-center gap-1 rounded-full bg-paper p-1">
            {TABS.map((item) => {
              const Icon = item.icon
              const active = tab === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px] transition ${
                    active ? 'bg-surface font-semibold text-ink' : 'text-sub hover:text-ink'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>

        {!session && (
          <EmptyState
            icon={<BellIcon className="h-7 w-7" />}
            title="登录后查看通知"
            description="通知接口需要论坛登录才能读取；未登录不会发起任何请求。"
            onLogin={onRequireLogin}
          />
        )}

        {session && status === 'loading' && !items.length && (
          <div>
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="flex gap-3 border-b border-line/60 px-4 py-4 last:border-b-0 sm:px-5"
              >
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-line/60" />
                <div className="min-w-0 flex-1 space-y-2 py-0.5">
                  <div className="h-3 w-2/5 animate-pulse rounded bg-line/60" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-line/60" />
                  <div className="h-5 w-14 animate-pulse rounded-full bg-line/40" />
                </div>
              </div>
            ))}
          </div>
        )}

        {session && status === 'error' && !items.length && (
          <RateLimitState
            onRetry={() => setReloadToken((value) => value + 1)}
            compact
          />
        )}

        {session && status === 'error' && items.length > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center px-4 py-10 text-center sm:px-5">
            <p className="text-[12.5px] text-sub">{privateErrorMessage(errorCode)}</p>
            <button
              type="button"
              onClick={() => setReloadToken((value) => value + 1)}
              className="mt-3 rounded-full border border-line px-4 py-1.5 text-[12px] text-sub transition hover:border-ink/25 hover:text-ink"
            >
              重新加载
            </button>
          </div>
        )}

        {session && status === 'idle' && visible.length === 0 && !hasMore && (
          <div className="flex flex-col items-center px-4 py-16 text-center sm:px-5">
            {tab === 'likes' ? (
              <HeartIcon className="h-8 w-8 text-sub/50" />
            ) : (
              <BackIcon className="h-8 w-8 text-sub/50" />
            )}
            <p className="mt-3 text-[12.5px] text-sub">
              {tab === 'likes' ? '还没有新的点赞和收藏' : '还没有新的互动'}
            </p>
          </div>
        )}

        {session &&
          (status === 'idle' || items.length > 0) &&
          visible.map((row) => {
            const created = timeAgo(row.createdAt)
            const { Icon: ActionIcon, color: iconColor } = notificationIcon(row.item.notification_type)

            return (
              <div
                key={row.key}
                role="button"
                tabIndex={0}
                onClick={() => handleOpen(row)}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleOpen(row)
                  }
                }}
                className={`relative flex gap-3 border-b border-line/60 px-4 py-3.5 transition last:border-b-0 sm:px-5 ${
                  row.unread
                    ? 'unread-row bg-unread hover:bg-unread-soft'
                    : 'bg-surface hover:bg-soft'
                } cursor-pointer`}
              >
                <div className="relative shrink-0 self-start">
                  <Avatar
                    template={avatarMap[row.avatarName] || avatarTemplateCache.get(row.avatarName)}
                    name={row.avatarName}
                    size={36}
                  />
                  <span
                    className={`absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-surface ring-1 ring-line/60 ${iconColor}`}
                  >
                    <ActionIcon className="h-3 w-3" />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] leading-5">
                      <span className="font-medium text-ink">{row.displayName}</span>
                      <span className="text-sub"> {row.label}</span>
                    </p>
                    {created && <span className="shrink-0 text-[12px] text-sub">{created}</span>}
                  </div>

                  {row.summary && (
                    <p className="mt-1 line-clamp-2 break-words text-[12px] leading-[1.65] text-sub">
                      {row.summary}
                    </p>
                  )}
                </div>
              </div>
            )
          })}

        {session && items.length > 0 && (
          <div className="px-4 py-4 sm:px-5">
            <div ref={sentinelRef} className="h-px" />
            {moreStatus === 'loading' && (
              <p className="text-center text-[12px] text-sub">加载中…</p>
            )}
            {moreStatus === 'error' && (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="mx-auto block rounded-full border border-line px-3 py-1 text-[12px] text-sub transition hover:border-ink/30 hover:text-ink"
              >
                重新加载
              </button>
            )}
            {moreStatus === 'idle' && !hasMore && visible.length > 0 && (
              <p className="text-center text-[12px] text-sub/70">
                没有更多了{totalRows !== null ? `（共 ${totalRows} 条）` : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
