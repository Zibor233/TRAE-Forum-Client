import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchPostLikers, errorMessage } from '../api'
import type { ForumUser } from '../types'
import { compactNumber } from '../lib/format'
import Avatar from './Avatar'
import { HeartIcon } from './icons'

interface Props {
  postId?: number
  apiKey?: string
  count: number
  liked: boolean
  busy: boolean
  onToggle: () => void
  large?: boolean
  readOnly?: boolean
  readOnlyReason?: string
}

export default function LikeButton({ postId, apiKey, count, liked, busy, onToggle, large, readOnly = false, readOnlyReason }: Props) {
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<ForumUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const cancelTimer = () => clearTimeout(timer.current)
  const closeSoon = () => { cancelTimer(); timer.current = setTimeout(() => setOpen(false), 180) }
  const show = () => {
    cancelTimer()
    if (!postId || count <= 0) return
    setOpen(true)
  }
  useLayoutEffect(() => {
    if (!open || !panel.current || !anchor.current) return
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect()
      const box = panel.current?.getBoundingClientRect()
      if (!rect || !box) return
      const below = rect.bottom + 8
      const top = below + box.height <= window.innerHeight - 8 ? below : rect.top - box.height - 8
      const next = { left: Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - box.height - 8)) }
      setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(panel.current)
    return () => observer.disconnect()
  }, [open])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { setOpen(false); setPage(0); setUsers([]) }, [postId, apiKey, count])
  useEffect(() => {
    if (!open || !postId) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetchPostLikers(postId, apiKey, page, controller.signal).then((data) => {
      if (controller.signal.aborted) return
      const next = data.post_action_users || []
      setUsers((prev) => page === 0 ? next : [...prev, ...next.filter((user) => !prev.some((item) => item.id === user.id))])
      setMore(next.length === 30 && (data.total_rows_post_action_users ?? count) > (page + 1) * 30)
    }).catch((err) => { if (!controller.signal.aborted) setError(errorMessage(err)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, postId, apiKey, count, page])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    const scroll = (event: Event) => { if (event.target instanceof Node && panel.current?.contains(event.target)) return; setOpen(false) }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', scroll)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', scroll)
    }
  }, [open])
  if (readOnly && count <= 0) return null
  return (
    <span ref={anchor} className="inline-flex items-center gap-1"
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') { cancelTimer(); timer.current = setTimeout(show, 250) } }}
      onPointerLeave={closeSoon}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !panel.current?.contains(event.relatedTarget)) closeSoon() }}>
      <button type="button" onFocus={show} title={readOnlyReason} onClick={readOnly ? show : onToggle} disabled={busy} aria-label={readOnly ? `查看点赞用户，共 ${count} 个赞` : liked ? '取消点赞' : '点赞'}
        className={`inline-flex items-center rounded-full py-1 disabled:opacity-60 ${liked ? 'text-[#ff2442]' : 'text-sub hover:text-ink'}`}>
        <HeartIcon className={`${large ? 'h-4 w-4' : 'h-3.5 w-3.5'} ${liked ? '[&_path]:fill-current' : ''}`} />
      </button>
      <button type="button" onClick={() => open ? setOpen(false) : show()} aria-label={`查看点赞用户，共 ${count} 个赞`} aria-expanded={open}
        className={`rounded py-1 hover:underline ${liked ? 'text-[#ff2442]' : 'text-sub'}`}>
        {compactNumber(count)}
      </button>
      {open && createPortal(
        <div ref={panel} role="dialog" aria-label="点赞用户" style={position}
          onPointerEnter={cancelTimer} onPointerLeave={closeSoon} onFocus={cancelTimer}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) closeSoon() }}
          className="fixed z-[80] w-[280px] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-surface p-3 text-ink shadow-lg">
          <div className="mb-2 flex items-center justify-between text-[12px] font-medium"><span>点赞用户</span><button aria-label="关闭点赞用户" onClick={() => setOpen(false)} className="px-1 text-sub">×</button></div>
          <div className="max-h-52 overflow-y-auto">
            {users.map((user) => <a key={user.id} href={`#/u/${encodeURIComponent(user.username)}`} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-soft">
              <Avatar template={user.avatar_template} name={user.name || user.username} size={26} />
              <span className="min-w-0 truncate text-[12px]">{user.name || user.username}<span className="ml-1 text-[10px] text-sub">@{user.username}</span></span>
            </a>)}
            {loading && <p role="status" className="py-3 text-center text-xs text-sub">加载中…</p>}
            {error && <p role="status" className="py-2 text-xs text-sub">{error}<button className="ml-2 underline" onClick={() => { setOpen(false); requestAnimationFrame(show) }}>重试</button></p>}
            {!loading && !error && !users.length && <p className="py-3 text-xs text-sub">暂无可显示的点赞用户</p>}
            {!loading && !error && more && <button onClick={() => setPage((prev) => prev + 1)} className="w-full py-2 text-xs text-sub hover:text-ink">加载更多</button>}
          </div>
        </div>, document.body)}
    </span>
  )
}
