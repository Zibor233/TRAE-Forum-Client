import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchEmojis } from '../api'
import { absolutize } from '../lib/format'
import type { EmojiGroup } from '../types'

interface EmojiPickerProps {
  open: boolean
  onClose: () => void
  /** 插入 `:name:` 短代码到光标处 */
  onInsert: (text: string) => void
}

/** 论坛表情面板：按需加载一次，支持分组与搜索；话题回复与聊天共用 */
export default function EmojiPicker({ open, onClose, onInsert }: EmojiPickerProps) {
  const [emojis, setEmojis] = useState<EmojiGroup[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    setStatus('loading')
    fetchEmojis()
      .then((groups) => {
        setEmojis(groups)
        setStatus('idle')
        if (groups[0]) setGroup(groups[0].name)
      })
      .catch(() => setStatus('error'))
  }, [open])

  const visibleEmojis = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return emojis
      .filter((item) => (keyword ? true : !group || item.name === group))
      .flatMap((item) =>
        item.emojis.filter((emoji) => !keyword || emoji.name.toLowerCase().includes(keyword)),
      )
      .slice(0, 240)
  }, [emojis, query, group])

  if (!open) return null

  return (
    <div className="mt-2 rounded-xl border border-line bg-surface-2 p-2">
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索表情"
          className="h-7 min-w-0 flex-1 rounded-full border border-line bg-surface px-2.5 text-[11.5px] text-ink outline-none"
        />
        <button onClick={onClose} className="shrink-0 px-2 text-[11.5px] text-sub hover:text-ink">
          关闭
        </button>
      </div>

      {!query && (
        <div className="no-scrollbar mt-1.5 flex gap-1 overflow-x-auto">
          {emojis.map((item) => (
            <button
              key={item.name}
              onClick={() => setGroup(item.name)}
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] transition ${
                group === item.name ? 'bg-surface font-medium text-ink' : 'text-sub hover:text-ink'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}

      {status === 'loading' && (
        <p className="py-4 text-center text-[11.5px] text-sub">表情加载中…</p>
      )}
      {status === 'error' && (
        <p className="py-4 text-center text-[11.5px] text-sub">
          表情列表加载失败，可直接输入 :name: 形式。
        </p>
      )}
      {status === 'idle' && (
        <div className="mt-1.5 grid max-h-[136px] grid-cols-8 gap-1 overflow-y-auto">
          {visibleEmojis.map((emoji) => (
            <button
              key={`${emoji.group}-${emoji.name}`}
              onClick={() => onInsert(`:${emoji.name}: `)}
              title={`:${emoji.name}:`}
              className="grid h-7 w-7 place-items-center rounded hover:bg-soft"
            >
              <img
                src={absolutize(emoji.url)}
                alt={emoji.name}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-5 w-5 object-contain"
              />
            </button>
          ))}
          {!visibleEmojis.length && (
            <p className="col-span-8 py-3 text-center text-[11.5px] text-sub">没有匹配的表情</p>
          )}
        </div>
      )}
    </div>
  )
}
