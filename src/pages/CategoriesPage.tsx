import { useEffect, useMemo, useState } from 'react'
import { fetchCategories } from '../api'
import { absolutize } from '../lib/format'
import type { Category } from '../types'
import { ChevronDownIcon, ChevronRightIcon } from '../components/icons'

interface CategoriesPageProps {
  onOpenCategory: (id: number) => void
}

/** 所有分类：一级分类纵向列表 + 可展开的子分类 */
export default function CategoriesPage({ onOpenCategory }: CategoriesPageProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  useEffect(() => {
    fetchCategories()
      .then((list) => {
        setCategories(list)
        setStatus('idle')
      })
      .catch(() => setStatus('error'))
  }, [])

  const roots = useMemo(
    () => categories.filter((category) => !category.parent_category_id),
    [categories],
  )

  const childrenOf = useMemo(() => {
    const groups = new Map<number, Category[]>()
    for (const category of categories) {
      if (!category.parent_category_id) continue
      const list = groups.get(category.parent_category_id) || []
      list.push(category)
      groups.set(category.parent_category_id, list)
    }
    return groups
  }, [categories])

  return (
    <div className="min-w-0 pb-20 pt-6">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-[17px] font-semibold text-ink">所有分类</h1>
        <a href="#/" className="text-[12px] text-sub hover:text-ink">
          返回首页
        </a>
      </div>

      {status === 'loading' && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-xl bg-surface p-8 text-center text-[13px] text-sub">
          暂无内容，
          <button
            onClick={() => window.location.reload()}
            className="text-ink underline underline-offset-2 hover:text-accent"
          >
            点击刷新
          </button>
        </div>
      )}

      {status === 'idle' && (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {roots.map((category) => {
            const children = childrenOf.get(category.id) || []
            const open = !!expanded[category.id]
            return (
              <div key={category.id} className="border-b border-line/60 last:border-b-0">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => onOpenCategory(category.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <CategoryMark category={category} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium text-ink">{category.name}</span>
                        {(category.unread_count ?? category.new_posts ?? 0) > 0 && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok-soft0"
                            title={`${category.unread_count ?? category.new_posts} 条未读`}
                          />
                        )}
                      </span>
                      {category.description_text && (
                        <span className="mt-0.5 line-clamp-1 block text-[11.5px] text-sub">
                          {category.description_text}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-sub">{category.topic_count} 帖</span>
                  </button>

                  {children.length > 0 && (
                    <button
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [category.id]: !prev[category.id] }))
                      }
                      aria-label={open ? '收起子分类' : '展开子分类'}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sub transition hover:bg-paper hover:text-ink"
                    >
                      {open ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                    </button>
                  )}
                </div>

                {open && children.length > 0 && (
                  <div className="pb-1 pl-10 pr-4">
                    {children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => onOpenCategory(child.id)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-paper"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: hexColor(child.color) }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{child.name}</span>
                        <span className="shrink-0 text-[11px] text-sub">{child.topic_count} 帖</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CategoryMark({ category }: { category: Category }) {
  const logo = category.uploaded_logo?.url || category.uploaded_background?.url
  if (logo) {
    return (
      <img
        src={absolutize(logo)}
        alt={category.name}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-7 w-7 shrink-0 rounded object-cover"
      />
    )
  }

  const emoji = leadingEmoji(category.name)
  if (emoji) {
    return <span className="grid h-7 w-7 shrink-0 place-items-center text-[18px]">{emoji}</span>
  }

  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded text-[12px] font-medium text-white"
      style={{ backgroundColor: hexColor(category.color) }}
    >
      {category.name.slice(0, 1)}
    </span>
  )
}

function hexColor(color?: string) {
  if (!color) return '#ff2e4d'
  return color.startsWith('#') ? color : `#${color}`
}

function leadingEmoji(name: string): string {
  const match = name.match(/\p{Extended_Pictographic}/u)
  return match ? match[0] : ''
}
