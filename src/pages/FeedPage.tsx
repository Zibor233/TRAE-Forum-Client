import LoadingIndicator from '../components/LoadingIndicator'
﻿import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import FeedCard, { feedCardEstimate } from '../components/FeedCard'
import FeaturedTopics from '../components/FeaturedTopics'
import SearchBar from '../components/SearchBar'
import TraeLogo from '../components/Logo'
import { ChevronDownIcon, FireIcon, TagIcon } from '../components/icons'
import {
  ApiError,
  fetchCategories,
  fetchCategoryTopics,
  fetchTags,
  fetchFeedTopics,
  peekCategoryTopics,
  peekFeedTopics,
  prefetchHomeExtras,
} from '../api'
import { changedTopics, topicRevision } from '../lib/feed'
import type { Category, ForumUser, TagItem, Topic, TopicList } from '../types'

type SortMode = 'latest' | 'hot' | 'rank'

const SORTS: { key: SortMode; label: string }[] = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '热门' },
  { key: 'rank', label: '排行榜' },
]

interface FeedPageProps {
  onCount?: (n: number) => void
  categoryId?: number | null
}

export default function FeedPage({ onCount, categoryId = null }: FeedPageProps) {
  const categoryMode = typeof categoryId === 'number'
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Topic[]>([])
  const [users, setUsers] = useState<Map<number, ForumUser>>(new Map())
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading')
  const extrasRef = useRef(false)
  const prefetchAtRef = useRef(0)
  const [finished, setFinished] = useState(false)
  const [featuredIds, setFeaturedIds] = useState<Set<number>>(new Set())
  const featuredRef = useRef<Set<number>>(new Set())

  // 分类页工具条状态
  const [subId, setSubId] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [tagList, setTagList] = useState<TagItem[]>([])
  const [tagSearch, setTagSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [noTags, setNoTags] = useState(false)
  const [tagError, setTagError] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const baselineRef = useRef<Map<number, string>>(new Map())
  const pendingIds = useRef<Set<number>>(new Set())
  const [sort, setSort] = useState<SortMode>('latest')
  const [orderMode, setOrderMode] = useState<'default' | 'created'>('default')
  const [rankFallback, setRankFallback] = useState(false)

  const pageRef = useRef(0)
  const seenRef = useRef<Set<number>>(new Set())
  const seqRef = useRef(0)
  const loadingRef = useRef(false)
  const requestRef = useRef<AbortController | null>(null)
  const usersRef = useRef<Map<number, ForumUser>>(new Map())
  // 视口锁定：追加前记录首个可见卡片的 top，追加后同帧抵消上推
  const listRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<{ el: HTMLElement; top: number } | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const captureAnchor = () => {
    const container = listRef.current
    if (!container) return
    const cards = container.querySelectorAll<HTMLElement>('[data-feed-card]')
    let best: HTMLElement | null = null
    let bestTop = Number.POSITIVE_INFINITY
    for (const card of cards) {
      const rect = card.getBoundingClientRect()
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue
      if (rect.top < bestTop) {
        bestTop = rect.top
        best = card
      }
    }
    anchorRef.current = best ? { el: best, top: bestTop } : null
  }

  const categoryById = useRef<Map<number, Category>>(new Map())

  useEffect(() => {
    fetchCategories()
      .then((list) => {
        setCategories(list)
        categoryById.current = new Map(list.map((c) => [c.id, c]))
      })
      .catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    fetchTags()
      .then(setTagList)
      .catch(() => setTagError(true))
  }, [])

  // 切换分类时重置工具条
  useEffect(() => {
    setSubId(null)
    setTags([])
    setNoTags(false)
    setSort('latest')
    setOrderMode('default')
    setRankFallback(false)
  }, [categoryId])

  const loadPage = useCallback(
    async (reset = false) => {
      const targetCategory = categoryMode ? (subId ?? categoryId!) : null
      const opts = {
        tags, noTags,
        topPeriod: null as string | null,
        order: orderMode,
      }
      if (sort === 'hot') opts.topPeriod = 'weekly'
      if (sort === 'rank') opts.topPeriod = 'all'

      if (reset) {
        requestRef.current?.abort()
        seqRef.current += 1
        pageRef.current = 0
        seenRef.current = new Set()
        baselineRef.current = new Map()
        pendingIds.current.clear()
        setPendingCount(0)
        setFinished(false)
        setStatus('loading')

        // 缓存优先：先用上次的第一页立即渲染，网络结果回来后替换
        const cached =
          targetCategory === null
            ? peekFeedTopics(null, 0, opts)
            : peekCategoryTopics(targetCategory, 0, opts)
        const cachedTopics = cached?.topics?.filter(
          (topic) => topic.archetype !== 'private_message' && !featuredRef.current.has(topic.id),
        )
        if (cachedTopics?.length) {
          setItems(cachedTopics)
          if (cached?.users?.length) {
            for (const user of cached.users) usersRef.current.set(user.id, user)
            setUsers(new Map(usersRef.current))
          }
        } else {
          setItems([])
        }
      } else if (loadingRef.current) {
        return
      }

      const controller = new AbortController()
      requestRef.current = controller
      loadingRef.current = true
      setStatus('loading')
      const seq = seqRef.current
      const page = pageRef.current
      try {
        let data: TopicList
        if (!categoryMode) {
          data = await fetchFeedTopics(null, page, opts, controller.signal)
        } else {
          try {
            data = await fetchCategoryTopics(targetCategory!, page, opts, controller.signal)
          } catch (err) {
            if (sort === 'rank' && err instanceof ApiError && err.status === 404) {
              setRankFallback(true)
              data = await fetchCategoryTopics(targetCategory!, page, { tags, noTags, order: 'likes' }, controller.signal)
            } else {
              throw err
            }
          }
        }
        if (seq !== seqRef.current) return

        if (page === 0) {
          baselineRef.current = new Map(data.topics.map(topic => [topic.id, topicRevision(topic)]))
          pendingIds.current.clear()
          setPendingCount(0)
        }
        if (data.users?.length) {
          for (const user of data.users) usersRef.current.set(user.id, user)
          setUsers(new Map(usersRef.current))
        }

        // 首页（page 0）用网络结果整体替换缓存，不能按 seenRef 去重——
        // 缓存只用于立即渲染，不参与翻页去重，否则会把首页话题全部过滤成空
        const fresh = data.topics.filter((topic) => {
          // 私信话题不进入公开信息流；社区置顶区已展示的也不在瀑布流重复
          if (topic.archetype === 'private_message') return false
          if (featuredRef.current.has(topic.id)) return false
          if (page > 0 && seenRef.current.has(topic.id)) return false
          return true
        })
        setFinished(!data.topics.length || data.more_topics_url === null)
        pageRef.current += 1
        if (page === 0) {
          seenRef.current = new Set(fresh.map((topic) => topic.id))
        } else {
          fresh.forEach((topic) => seenRef.current.add(topic.id))
        }
        if (!fresh.length && page === 0) {
          // 上游确实没有返回任何话题时才判定为「没有更多」；仅被置顶过滤则继续翻页
          setItems([])
        } else {
          if (page === 0) {
            setItems(fresh)
          } else {
            // 先记录当前视口锚点，追加后由 useLayoutEffect 同帧补偿
            captureAnchor()
            setItems((prev) => [...prev, ...fresh])
          }
        }
        setStatus('idle')

        // 首屏渲染完成后做低优先级预取（周榜 / 分类），只触发一次
        if (!extrasRef.current) {
          extrasRef.current = true
          prefetchHomeExtras()
        }
      } catch {
        if (seq === seqRef.current && !controller.signal.aborted) setStatus('error')
      } finally {
        if (seq === seqRef.current) loadingRef.current = false
      }
    },
    [categoryMode, categoryId, subId, tags, noTags, sort, orderMode],
  )

  useEffect(() => {
    loadPage(true)
    return () => {
      requestRef.current?.abort()
      seqRef.current += 1
    }
  }, [loadPage])

  // A single low-priority check per minute; pause while hidden or viewing a topic modal.
  useEffect(() => {
    const controller = new AbortController()
    let running = false
    let lastCheck = Date.now()
    const check = async () => {
      if (running || controller.signal.aborted || loadingRef.current || !baselineRef.current.size ||
          document.hidden || navigator.onLine === false || window.location.hash.includes('/topic/') ||
          sort !== 'latest' || Date.now() - lastCheck < 60_000) return
      running = true
      lastCheck = Date.now()
      try {
        const data = await fetchFeedTopics(categoryMode ? (subId ?? categoryId) : null, 0, { tags, noTags, order: orderMode }, controller.signal, 'prefetch')
        if (controller.signal.aborted) return
        for (const topic of changedTopics(baselineRef.current, data.topics)) pendingIds.current.add(topic.id)
        setPendingCount(pendingIds.current.size)
      } catch { /* A failed background check never interrupts reading. */ }
      finally { running = false }
    }
    const timer = window.setInterval(() => void check(), 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
  }, [categoryMode, categoryId, subId, tags, noTags, orderMode, sort])

  useEffect(() => {
    onCount?.(items.length)
  }, [items.length, onCount])

  // 触底加载：sentinel 进入视口时取下一页；连续滚动最多每 300ms 触发一批
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (finished || status === 'error' || loadingRef.current) return
        const now = Date.now()
        if (now - prefetchAtRef.current < 300) return
        prefetchAtRef.current = now
        loadPage()
      },
      { rootMargin: '0px 0px 500px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [finished, status, loadPage, items.length])

  // 视口锁定：追加数据后若锚点被上推（delta > 0），立即同帧抵消，避免视觉上整体上移
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    anchorRef.current = null
    const delta = anchor.el.getBoundingClientRect().top - anchor.top
    if (delta > 0.5) window.scrollBy(0, delta)
  }, [items.length])

  const topCategories = categories
    .filter((category) => !category.parent_category_id)
    .slice(0, 6)

  const current = categoryMode ? categoryById.current.get(categoryId) : undefined
  const subcategories = categoryMode
    ? categories.filter((category) => category.parent_category_id === categoryId)
    : []
  const newCount = items.reduce((sum, topic) => sum + (topic.unread_posts ?? topic.new_posts ?? 0), 0)

  const goCategory = (id: number | null) => {
    window.location.hash = id ? `/c/${id}` : '/'
  }

  const empty = !items.length && status === 'idle' && finished

  // 分列由前端按估算高度分配：翻页时只把新卡片追加到最短列末尾，
  // 已渲染的卡片不会被 CSS columns 的平衡算法重新分配到别的列（滚动时整列跳动）。
  const columnCount = useColumnCount()
  const visibleItems = useMemo(
    () => items.filter((topic) => !featuredIds.has(topic.id)),
    [items, featuredIds],
  )
  const columns = useMemo(() => distributeColumns(visibleItems, columnCount), [visibleItems, columnCount])

  return (
    <div className="min-h-[calc(100svh+120px)] min-w-0 pb-20 pt-4 [overflow-anchor:none] sm:pt-6">
      {/* 移动端没有侧栏，品牌与搜索放在内容顶部 */}
      <div className="mb-4 flex items-center gap-2.5 px-0.5 md:hidden">
        <TraeLogo className="h-[21px] w-[28px] text-[#ff2442]" />
        <span className="text-[17px] font-semibold tracking-tight text-ink">TRAE社区第三方客户端</span>
      </div>

      <SearchBar className="mb-5" />

      <section aria-label="话题筛选" className="mb-5">
        <div className="flex items-center gap-4">
          <nav aria-label="话题分类" className="no-scrollbar flex min-w-0 flex-1 items-center gap-6 overflow-x-auto px-1 sm:gap-7">
            <button onClick={() => goCategory(null)} aria-current={!categoryMode ? 'page' : undefined} className={`feed-category ${!categoryMode ? 'is-active' : ''}`}>全部</button>
            {topCategories.map((category) => (
              <button key={category.id} onClick={() => goCategory(category.id)} aria-current={categoryMode && categoryId === category.id ? 'page' : undefined} className={`feed-category ${categoryMode && categoryId === category.id ? 'is-active' : ''}`}>
                {category.name}
              </button>
            ))}
            <a href="#/categories" className="feed-category">更多分类<span className="ml-1 text-xs">›</span></a>
          </nav>
          <button aria-expanded={filtersOpen} aria-controls="feed-filters" onClick={() => setFiltersOpen(value => !value)} className={`flex shrink-0 items-center gap-1.5 py-3 text-[12px] transition hover:text-ink ${filtersOpen || tags.length || noTags || sort !== 'latest' || orderMode !== 'default' ? 'text-accent' : 'text-sub'}`}>
            <TagIcon className="h-3.5 w-3.5" />筛选
            <ChevronDownIcon className={`h-3 w-3 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {filtersOpen && <div id="feed-filters" className="relative mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
          {subcategories.length > 0 && (
            <DropMenu label={subId ? subLabel(subId, subcategories) : '子类别'} active={!!subId}>
              {(close) => (
                <div className="w-44">
                  <MenuItem
                    onClick={() => {
                      setSubId(null)
                      close()
                    }}
                    selected={!subId}
                  >
                    全部子类别
                  </MenuItem>
                  {subcategories.map((category) => (
                    <MenuItem
                      key={category.id}
                      selected={subId === category.id}
                      onClick={() => {
                        setSubId(category.id)
                        close()
                      }}
                    >
                      {category.name}
                    </MenuItem>
                  ))}
                </div>
              )}
            </DropMenu>
          )}

          {(
            <DropMenu
              label={noTags ? '无标签' : tags.length ? `标签 ${tags.length}` : '标签'}
              active={noTags || tags.length > 0}
              icon={<TagIcon className="h-3.5 w-3.5" />}
            >
              {() => (
                <div className="w-60">
                  <input aria-label="搜索标签" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="搜索标签…" className="mb-1 w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm text-ink" />
                  <MenuItem selected={!noTags && !tags.length} onClick={() => { setNoTags(false); setTags([]) }}>所有标签 / 清除筛选</MenuItem>
                  <MenuItem selected={noTags} onClick={() => { setNoTags(true); setTags([]) }}>无标签</MenuItem>
                  {tagError && <button className="px-2 py-2 text-xs text-sub" onClick={() => { setTagError(false); fetchTags().then(setTagList).catch(() => setTagError(true)) }}>标签加载失败，点击重试</button>}
                  <div className="max-h-60 overflow-y-auto">
                  {tagList.filter(tag => tag.name.toLocaleLowerCase().includes(tagSearch.toLocaleLowerCase())).map((tag) => {
                    const selected = tags.includes(tag.name)
                    return (
                      <label
                        key={tag.name}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-ink hover:bg-paper"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            setNoTags(false)
                            setTags((prev) =>
                              prev.includes(tag.name)
                                ? prev.filter((item) => item !== tag.name)
                                : [...prev, tag.name],
                            )
                          }}
                          className="h-3.5 w-3.5 accent-[#ff2442]"
                        />
                        <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                        {typeof tag.topic_count === 'number' && (
                          <span className="text-[11px] text-sub">{tag.topic_count}</span>
                        )}
                      </label>
                    )
                  })}
                  </div>
                </div>
              )}
            </DropMenu>
          )}

          <button
            onClick={() => {
              setSort('latest')
              setOrderMode('created')
            }}
            className={`shrink-0 rounded-lg border px-3 py-2 text-[12px] transition ${
              orderMode === 'created'
                ? 'border-accent/20 bg-accent/10 text-accent'
                : 'border-line bg-surface text-sub hover:text-ink'
            }`}
            title="按创建时间排序，查看新帖"
          >
            新帖{newCount > 0 ? ` · ${newCount}` : ''}
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1 rounded-lg bg-paper p-1">
            {SORTS.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setSort(item.key)
                  setOrderMode('default')
                }}
                className={`relative rounded-md px-3 py-1.5 text-[12px] transition ${
                  sort === item.key && orderMode === 'default' ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-sub hover:text-ink'
                }`}
              >
                {item.key === 'hot' && <FireIcon className="mr-0.5 inline h-3 w-3 align-[-2px]" />}
                {item.label}

              </button>
            ))}
          </div>
        </div>}
      </section>

      {pendingCount > 0 && <button onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); void loadPage(true) }} className="my-3 block w-full rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-accent">查看 {pendingCount} 个新的或更新的话题 · 点击刷新</button>}

      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}
              className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11.5px] text-sub hover:text-ink"
            >
              #{tag}
              <span className="text-[10px]">✕</span>
            </button>
          ))}
        </div>
      )}

      {rankFallback && sort === 'rank' && (
        <p className="mt-2 text-[11.5px] text-sub">该站点 /top.json?period=all 不可用，已退回按赞数排序。</p>
      )}

      <FeaturedTopics
        onTopics={(ids) => {
          featuredRef.current = new Set(ids)
          setFeaturedIds(new Set(ids))
        }}
      />

      {status === 'error' && !items.length && (
        <div className="mt-16 text-center text-sm text-sub">
          暂无内容，
          <button
            onClick={() => loadPage(true)}
            className="text-ink underline underline-offset-2 hover:text-accent"
          >
            点击刷新
          </button>
        </div>
      )}

      {columns.some((column) => column.length > 0) && (
        <div ref={listRef} className="mt-3 flex items-start gap-3">
          {columns.map((column, index) => (
            <div key={index} className="flex min-w-0 flex-1 flex-col gap-y-3.5">
              {column.map((topic, row) => (
                <FeedCard
                  key={topic.id}
                  entranceDelay={Math.min(row * columnCount + index, 7) * 25}
                  topic={topic}
                  users={
                    topic.posters
                      ?.map((poster) => users.get(poster.user_id))
                      .filter(Boolean) as ForumUser[]
                  }
                  category={
                    topic.category_id ? categoryById.current.get(topic.category_id) : current
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {status === 'loading' && !items.length && (
        <div className="masonry mt-3 columns-2 md:columns-3 lg:columns-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-lg bg-paper">
              <div className="grid aspect-[4/3] w-full place-items-center bg-line/40"><LoadingIndicator /></div>
            </div>
          ))}
        </div>
      )}

      {empty && (
        <div className="mt-16 text-center text-sm text-sub">
          {categoryMode ? '这个分类下暂时没有内容，换个分类或清空标签看看。' : '暂时没有内容，稍后再来看看。'}
        </div>
      )}

      {items.length > 0 && (
        <div
          ref={sentinelRef}
          className="mt-3 flex h-14 items-center justify-center gap-2 text-[12px] text-sub"
        >
          {status === 'error' ? (
            <button
              onClick={() => loadPage()}
              className="rounded-full border border-line px-3 py-1 text-[12px] text-sub transition hover:border-ink/30 hover:text-ink"
            >
              重新加载
            </button>
          ) : finished ? (
            '已经到底了'
          ) : (
            <>
              {status === 'loading' && (
                <LoadingIndicator />
              )}
              {status === 'loading' ? '正在加载更多…' : '继续下滑自动加载'}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function subLabel(id: number, list: Category[]) {
  return list.find((category) => category.id === id)?.name || '子类别'
}

/** 与 columns-2 / md:columns-3 / lg:columns-4 的断点保持一致 */
function columnCountForWidth(width: number) {
  if (width >= 1024) return 4
  if (width >= 768) return 3
  return 2
}

function useColumnCount() {
  const [count, setCount] = useState(() => columnCountForWidth(window.innerWidth))
  useEffect(() => {
    const onResize = () => setCount(columnCountForWidth(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return count
}

/** 按估算高度贪心分列：追加数据时只影响最短列，已有卡片不跨列 */
function distributeColumns(items: Topic[], count: number) {
  const columns: Topic[][] = Array.from({ length: count }, () => [])
  const heights = new Array(count).fill(0)
  for (const topic of items) {
    let target = 0
    for (let i = 1; i < count; i += 1) {
      if (heights[i] < heights[target]) target = i
    }
    columns[target].push(topic)
    // 14 为卡片间距（gap-y-3.5），与视觉间距一致即可
    heights[target] += feedCardEstimate(topic) + 14
  }
  return columns
}

function DropMenu({
  label,
  active,
  icon,
  children,
}: {
  label: string
  active?: boolean
  icon?: ReactNode
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] transition ${
          active || open ? 'border-[#ff2442] text-[#ff2442]' : 'border-line bg-surface text-sub hover:text-ink'
        }`}
      >
        {icon}
        {label}
        <ChevronDownIcon className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 rounded-xl border border-line bg-surface-2 p-1.5">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  children,
  selected,
  onClick,
}: {
  children: ReactNode
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-paper ${
        selected ? 'font-medium text-[#ff2442]' : 'text-ink'
      }`}
    >
      {children}
    </button>
  )
}
