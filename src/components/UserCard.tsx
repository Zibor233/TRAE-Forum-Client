import { useEffect, useRef, useState } from 'react'
import { ApiError, createDirectChat, createPrivateMessage, errorMessage, fetchChatOverview, fetchUserProfile } from '../api'
import type { AuthSession } from '../lib/auth'
import { USER_CARD_EVENT } from '../lib/userCard'
import type { UserProfile } from '../types'
import { fullDate, compactNumber } from '../lib/format'
import Avatar from './Avatar'
import { lockBodyScroll } from '../lib/scrollLock'
import { CloseIcon } from './icons'

export default function UserCard({ session, onRequireLogin }: { session: AuthSession | null; onRequireLogin: () => void }) {
  const [username, setUsername] = useState<string | null>(null)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false)
  const [requestedChat, setRequestedChat] = useState(false)
  const [title, setTitle] = useState('')
  const [raw, setRaw] = useState('')
  const busyRef = useRef(busy)
  busyRef.current = busy
  const version = useRef(0)
  const closeRef = useRef<HTMLButtonElement>(null)
  const close = () => { if (!busy) setUsername(null) }
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail
      const name = typeof detail === 'string' ? detail : detail?.username
      if (typeof name === 'string') { setUsername(name); setWriting(detail?.action === 'private'); setRequestedChat(detail?.action === 'chat'); setTitle(''); setRaw(''); setError('') }
    }
    window.addEventListener(USER_CARD_EVENT, open)
    return () => window.removeEventListener(USER_CARD_EVENT, open)
  }, [])
  useEffect(() => {
    version.current += 1
    setBusy(false)
    setUser(null)
    setError('')
    if (!username || !session) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    fetchUserProfile(username, session.key, controller.signal).then((data) => {
      if (!controller.signal.aborted) setUser(data)
    }).catch((err) => { if (!controller.signal.aborted) setError(errorMessage(err)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [username, session?.key])
  useEffect(() => {
    if (!username) return
    const unlock = lockBodyScroll()
    const focused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busyRef.current) setUsername(null) }
    }
    window.addEventListener('keydown', escape, true)
    return () => { unlock(); window.removeEventListener('keydown', escape, true); focused?.focus() }
  }, [Boolean(username)])
  const chat = async () => {
    if (!session) { setUsername(null); onRequireLogin(); return }
    if (!username || busy) return
    const generation = version.current
    setBusy(true); setError('')
    try {
      // 已有的两人会话直接复用；多人会话不能误当成私聊。
      const overview = await fetchChatOverview(session.key)
      let channel = overview.direct_message_channels?.find((item) => {
        const others = item.chatable?.users?.filter((peer) => peer.username !== session.username) || []
        return others.length === 1 && others[0].username === username
      })
      if (!channel) channel = (await createDirectChat(session.key, username)).channel
      if (!channel?.id) throw new Error('论坛没有返回聊天频道，请稍后重试')
      if (generation !== version.current) return
      setUsername(null)
      window.location.hash = `/messages/${channel.id}`
    } catch (err) {
      if (generation === version.current) setError(err instanceof ApiError && err.status === 404 ? '本站暂未开放创建聊天接口，可前往官方页面发起聊天。已有会话仍可在消息页打开。' : errorMessage(err))
    } finally { if (generation === version.current) setBusy(false) }
  }
  useEffect(() => {
    if (!requestedChat || !username) return
    setRequestedChat(false)
    void chat()
  }, [requestedChat, username])
  const sendPrivate = async () => {
    if (!session || !username || busy || !title.trim() || !raw.trim()) return
    const generation = version.current
    setBusy(true); setError('')
    try {
      const created = await createPrivateMessage(session.key, username, title.trim(), raw.trim())
      if (!created.topic_id) throw new Error('论坛未返回私信话题，请检查发送结果')
      if (generation !== version.current) return
      setUsername(null)
      window.location.hash = `/topic/${created.topic_id}`
    } catch (err) { if (generation === version.current) setError(errorMessage(err)) }
    finally { if (generation === version.current) setBusy(false) }
  }
  if (!username) return null
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4" onClick={close}>
    <section role="dialog" aria-modal="true" aria-label={writing ? `私信 @${username}` : `@${username} 的资料`} onClick={(event) => event.stopPropagation()}
      className="relative max-h-[90dvh] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-xl">
      <button ref={closeRef} disabled={busy} onClick={close} aria-label="关闭用户资料" className="absolute right-4 top-4 rounded-full p-1 text-sub hover:bg-soft disabled:opacity-40"><CloseIcon className="h-5 w-5" /></button>
      {user?.card_background_upload_url && <img src={new URL(user.card_background_upload_url, 'https://forum.trae.cn').href} alt="用户卡片背景" className="mb-4 h-32 w-full rounded-lg object-cover" />}
      <div className="flex items-start gap-4 pr-7">
        <Avatar template={user?.avatar_template} name={user?.name || username} size={72} />
        <div className="min-w-0"><h2 className="break-words text-xl font-semibold text-ink">{user?.name || username}</h2><p className="mt-1 break-all text-sm text-sub">@{username}</p>
          {(user?.title || user?.primary_group_name) && <p className="mt-2 text-sm text-sub">{user.title || user.primary_group_name}</p>}
          {(user?.admin || user?.moderator) && <span className="mt-2 inline-block rounded bg-soft px-2 py-1 text-xs text-sub">{user.admin ? '管理员' : '版主'}</span>}
        </div>
      </div>
      {loading && <p role="status" className="mt-4 text-sm text-sub">资料加载中…</p>}
      {user && <div className="mt-5 flex flex-wrap gap-4 border-t border-line pt-4 text-xs text-sub">
        {user.created_at && <span>加入于 {fullDate(user.created_at).split(' ')[0]}</span>}
        {typeof user.post_count === 'number' && <span>{compactNumber(user.post_count)} 帖子</span>}
        {typeof user.likes_received === 'number' && <span>获赞 {compactNumber(user.likes_received)}</span>}
      </div>}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <a href={`#/u/${encodeURIComponent(username)}`} onClick={close} className="rounded-full border border-line px-4 py-2 text-sm text-sub">查看主页</a>
        {username !== session?.username && <>
          <button disabled={busy || user?.can_send_private_message_to_user === false} onClick={() => { if (!session) { setUsername(null); onRequireLogin() } else setWriting(true) }} title={user?.can_send_private_message_to_user === false ? '当前账号无法向此用户发送私信' : '发送带标题的私信'} className="rounded-full bg-accent-fill px-4 py-2 text-sm text-white disabled:opacity-40">私信</button>
          <button disabled={busy} onClick={() => void chat()} className="rounded-full border border-line px-4 py-2 text-sm text-ink disabled:opacity-40">{busy && !writing ? '打开聊天中…' : '聊天'}</button>
        </>}
      </div>
      {writing && <form onSubmit={(event) => { event.preventDefault(); void sendPrivate() }} className="mt-5 space-y-3 border-t border-line pt-4">
        <p className="text-sm text-sub">私信收件人：@{username}</p>
        <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="私信标题" aria-label="私信标题" className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink" />
        <textarea value={raw} onChange={(event) => setRaw(event.target.value)} rows={6} placeholder="私信正文，支持 Markdown…" aria-label="私信正文" className="w-full resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink" />
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setWriting(false)} className="px-3 py-2 text-sm text-sub">返回资料</button><button disabled={busy || !title.trim() || !raw.trim()} className="rounded-full bg-accent-fill px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? '发送中…' : '发送私信'}</button></div>
      </form>}
      {error && <p role="alert" className="mt-4 whitespace-pre-wrap text-sm text-red-600">{error}</p>}
      <a href={`https://forum.trae.cn/u/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-xs text-sub hover:underline">在官方论坛查看</a>
    </section>
  </div>
}
