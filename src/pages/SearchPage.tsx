import { useEffect, useMemo, useState } from 'react'
import FeedCard from '../components/FeedCard'
import SearchBar from '../components/SearchBar'
import { BackIcon, SearchIcon } from '../components/icons'
import { searchForum } from '../api'
import { compactNumber, timeAgo } from '../lib/format'
import type { SearchResult, Topic } from '../types'

interface SearchPageProps {
  query: string
}

export default function SearchPage({ query }: SearchPageProps) {
  const [result, setResult] = useState<SearchResult | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!query.trim()) {
      setResult(null)
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    let alive = true
    setStatus('loading')
    setResult(null)

    searchForum(query, controller.signal)
      .then((data) => {
        if (!alive) return
        setResult(data)
        setStatus('idle')
      })
      .catch(() => {
        if (!alive) return
        setStatus('error')
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [query, reloadKey])

  // 私信话题不进公开搜索：话题卡片与其回复都过滤掉
  const privateTopicIds = new Set(
    (result?.topics ?? [])
      .filter((topic) => topic.archetype === 'private_message')
      .map((topic) => topic.id),
  )
  const topics = (result?.topics ?? []).filter(
    (topic) => topic.archetype !== 'private_message',
  )
  const postTopics = useMemo(() => {
    const seen = new Set<number>()
    return (result?.posts ?? []).filter((post) => {
      if (privateTopicIds.has(post.topic_id)) return false
      if (seen.has(post.topic_id)) return false
      seen.add(post.topic_id)
      return true
    })
  }, [result, privateTopicIds])

  const total = topics.length + postTopics.length

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-4 sm:pt-6">
      <a
        href="#/"
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] text-sub transition hover:bg-soft hover:text-ink"
      >
        <BackIcon className="h-4 w-4" />
        返回信息流
      </a>

      <div className="mt-3">
        <SearchBar query={query} />
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink sm:text-[24px]">
            {query ? `搜索「${query}」` : '搜索社区'}
          </h1>
          <p className="mt-1 text-[12px] text-sub">
            {query
              ? status === 'loading'
                ? '正在检索 forum.trae.cn…'
                : `共找到 ${total} 条相关结果`
              : '输入关键词，检索官方论坛的公开话题与回复'}
          </p>
        </div>
      </div>

      {!query.trim() && (
        <div className="mt-10 rounded-2xl bg-surface p-10 text-center">
          <SearchIcon className="mx-auto h-8 w-8 text-sub/60" />
          <p className="mt-3 text-[13px] text-sub">在上方输入关键词，例如「SOLO」「报错」「技巧」。</p>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-10 text-center text-[13px] text-sub">
          暂无内容，
          <button
            onClick={() => setReloadKey((value) => value + 1)}
            className="text-ink underline underline-offset-2 hover:text-accent"
          >
            点击刷新
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl bg-soft/70" />
          ))}
        </div>
      )}

      {status === 'idle' && query && total === 0 && (
        <div className="mt-10 rounded-2xl bg-surface p-10 text-center">
          <p className="text-sm text-ink">没有找到与「{query}」相关的内容</p>
          <p className="mt-2 text-[12px] text-sub">试试更短的关键词，或直接浏览最新信息流。</p>
        </div>
      )}

      {topics.length > 0 && (
        <section className="mt-7">
          <SectionTitle title="相关话题" count={topics.length} />
          <div className="masonry mt-3 columns-1 sm:columns-2 lg:columns-3">
            {topics.map((topic) => (
              <FeedCard key={topic.id} topic={topic} />
            ))}
          </div>
        </section>
      )}

      {postTopics.length > 0 && (
        <section className="mt-7">
          <SectionTitle title="相关回复" count={postTopics.length} />
          <div className="mt-3 space-y-2.5">
            {postTopics.map((post) => {
              const matched: Topic | undefined = topics.find((topic) => topic.id === post.topic_id)
              return (
                <a
                  key={`${post.topic_id}-${post.post_number}`}
                  href={`#/topic/${post.topic_id}`}
                  className="group block rounded-2xl bg-surface px-4 py-3.5 transition hover:bg-soft/60"
                >
                  <div className="flex items-center gap-2 text-[11.5px] text-sub">
                    <span className="font-medium text-ink">{post.username}</span>
                    <span>·</span>
                    <span>#{post.post_number}</span>
                    {post.created_at && <span>· {timeAgo(post.created_at)}</span>}
                    <span className="ml-auto text-accent opacity-0 transition group-hover:opacity-100">查看话题 →</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-[1.65] text-ink/80">
                    {stripHtml(post.blurb)}
                  </p>
                  {matched && (
                    <p className="mt-1 line-clamp-1 text-[11.5px] text-sub">话题：{matched.title}</p>
                  )}
                </a>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-sub ring-1 ring-line">
        {compactNumber(count)}
      </span>
    </div>
  )
}

function stripHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
