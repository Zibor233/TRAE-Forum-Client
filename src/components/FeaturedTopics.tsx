import { useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import { fetchFeaturedTopics, peekFeaturedTopics } from '../api'
import { topicImage } from '../lib/format'
import { resolveTopicAuthor } from '../lib/topic'
import type { ForumUser, Topic } from '../types'

interface FeaturedTopicsProps {
  /** 置顶已展示的 topic id，瀑布流需要去重 */
  onTopics?: (ids: number[]) => void
}

const MAX_FEATURED = 4

/** 社区置顶：站点用 tag=featured 维护首页推荐位（/tag/featured.json） */
export default function FeaturedTopics({ onTopics }: FeaturedTopicsProps) {
  // 缓存优先：先用上次的置顶立即渲染，网络结果回来后再替换
  const cachedRef = useRef(peekFeaturedTopics())
  const initial = (cachedRef.current?.topics || [])
    .filter((topic) => topic.archetype !== 'private_message')
    .slice(0, MAX_FEATURED)
  const [topics, setTopics] = useState<Topic[]>(initial)
  const [users, setUsers] = useState<ForumUser[]>(cachedRef.current?.users || [])

  useEffect(() => {
    if (initial.length) onTopics?.(initial.map((topic) => topic.id))
  }, [])

  useEffect(() => {
    let alive = true
    fetchFeaturedTopics()
      .then((data) => {
        if (!alive) return
        const list = (data.topics || [])
          .filter((topic) => topic.archetype !== 'private_message')
          .slice(0, MAX_FEATURED)
        setUsers(data.users || [])
        setTopics((prev) =>
          prev.length === list.length && prev.every((topic, index) => topic.id === list[index].id)
            ? prev
            : list,
        )
        onTopics?.(list.map((topic) => topic.id))
      })
      .catch(() => {
        // 预取失败保留缓存内容，不清空
      })
    return () => {
      alive = false
    }
  }, [])

  if (!topics.length) return null

  return (
    <section className="mt-0">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-sub">社区置顶</p>
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 xl:grid-cols-4 md:gap-5 md:overflow-visible md:px-0">
        {topics.map((topic) => {
          const author = resolveTopicAuthor(topic, users)
          const cover = topicImage(topic)
          return (
            <a
              key={topic.id}
              href={`#/topic/${topic.id}`}
              className="flex w-[260px] shrink-0 snap-start items-start gap-2.5 rounded-xl border border-line bg-surface p-3 transition hover:border-ink/25 md:w-auto"
            >
              {cover && (
                <img
                  src={cover}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
                  {topic.title}
                </h3>
                <div className="mt-2 flex items-center gap-1.5">
                  <Avatar
                    template={author.avatarTemplate}
                    name={author.name || author.username}
                    size={22}
                  />
                  <span className="truncate text-[11.5px] text-sub">
                    {author.name || author.username}
                  </span>
                </div>
              </div>
            </a>
          )
        })}
      </div>
    </section>
  )
}
