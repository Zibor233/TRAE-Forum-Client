import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { changeUsername, errorMessage, featureUserTopic, fetchUserProfile, pickUserAvatar, updateUserProfile, uploadImage } from '../api'
import { loadSession, saveSession, type AuthSession } from '../lib/auth'
import { lockBodyScroll } from '../lib/scrollLock'
import type { UserProfile } from '../types'
import Avatar from './Avatar'

const fieldClass = 'mt-2 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink disabled:opacity-50'
const imageUrl = (url: string) => new URL(url, 'https://forum.trae.cn').href

export default function ProfileEditor({ user: initialUser, session, onClose, onSaved }: {
  user: UserProfile; session: AuthSession; onClose: () => void; onSaved: (user: UserProfile) => void
}) {
  const [user, setUser] = useState(initialUser)
  const [loading, setLoading] = useState(true)
  const [loadVersion, setLoadVersion] = useState(0)
  const [username, setUsername] = useState(user.username)
  const [name, setName] = useState(user.name || '')
  const [title, setTitle] = useState(user.title || '')
  const [bio, setBio] = useState(user.bio_raw || '')
  const [location, setLocation] = useState(user.location || '')
  const [timezone, setTimezone] = useState(user.user_option?.timezone || '')
  const [hidden, setHidden] = useState(user.user_option?.hide_profile ?? false)
  const [background, setBackground] = useState(user.card_background_upload_url || '')
  const [featured, setFeatured] = useState(String(user.featured_topic?.id || ''))
  const [avatar, setAvatar] = useState<{ id: number; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const applied = useRef(false)
  const alive = useRef(true)
  const closeButton = useRef<HTMLButtonElement>(null)
  const lastUser = useRef(user)
  const close = () => {
    if (savingRef.current) return
    if (applied.current) onSaved(lastUser.current)
    onClose()
  }
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    alive.current = true
    const unlock = lockBodyScroll()
    const focused = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current() } }
    window.addEventListener('keydown', escape, true)
    return () => { alive.current = false; unlock(); window.removeEventListener('keydown', escape, true); focused?.focus({ preventScroll: true }) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetchUserProfile(session.username, session.key, controller.signal).then((fresh) => {
      if (controller.signal.aborted) return
      setUser(fresh)
      lastUser.current = fresh
      setUsername(fresh.username); setName(fresh.name || ''); setTitle(fresh.title || '')
      setBio(fresh.bio_raw || ''); setLocation(fresh.location || '')
      setTimezone(fresh.user_option?.timezone || '')
      setHidden(fresh.user_option?.hide_profile ?? false)
      setBackground(fresh.card_background_upload_url || '')
      setFeatured(String(fresh.featured_topic?.id || ''))
      setLoading(false)
    }).catch((err) => { if (!controller.signal.aborted) setError(errorMessage(err)) })
    return () => controller.abort()
  }, [session.key, session.username, loadVersion])

  const upload = async (file: File | undefined, kind: 'avatar' | 'card_background') => {
    if (!file || uploading || busy) return
    if (!file.type.startsWith('image/')) { setError('请选择图片文件'); return }
    setUploading(true); setError('')
    try {
      const result = await uploadImage(session.key, file, kind)
      if (!alive.current) return
      if (result.errors?.length) throw new Error(result.errors.join('；'))
      if (!result.url || (kind === 'avatar' && !result.id)) throw new Error('上传未返回有效的图片信息')
      if (kind === 'avatar') setAvatar({ id: result.id!, url: imageUrl(result.url) })
      else setBackground(result.url)
    } catch (err) { if (alive.current) setError(errorMessage(err)) }
    finally { if (alive.current) setUploading(false) }
  }

  const save = async () => {
    if (savingRef.current || uploading || loading) return
    const nextUsername = username.trim()
    if (!nextUsername) { setError('用户名不能为空'); return }
    const topicMatch = featured.trim().match(/^\d+$/) || featured.trim().match(/\/(?:t\/(?:[^/]+\/)?|topic\/)(\d+)/)
    const topicId = featured.trim() ? Number(topicMatch?.[1] || topicMatch?.[0]) : null
    if (featured.trim() && (!topicId || !Number.isSafeInteger(topicId))) { setError('精选话题请填写话题编号或话题链接'); return }
    if (timezone) {
      try { new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }) } catch { setError('请选择有效的时区，如 Asia/Shanghai'); return }
    }
    savingRef.current = true; setBusy(true); setError('')
    let currentUsername = session.username
    try {
      const result = await updateUserProfile(currentUsername, session.key, {
        ...(user.can_edit_name !== false ? { name } : {}), title,
        ...(user.can_change_bio !== false ? { bio_raw: bio } : {}),
        ...(user.can_change_location !== false ? { location } : {}),
        timezone, hide_profile: hidden,
        ...(user.can_upload_user_card_background !== false ? { card_background_upload_url: background } : {}),
      })
      applied.current = true
      if (result.user) lastUser.current = result.user
      if (avatar) { await pickUserAvatar(currentUsername, session.key, avatar.id); if (alive.current) setAvatar(null) }
      if (topicId !== (user.featured_topic?.id || null)) await featureUserTopic(currentUsername, session.key, topicId)
      let fresh = await fetchUserProfile(currentUsername, session.key)
      lastUser.current = fresh
      if ((fresh.title || '') !== title) throw new Error('其他资料已保存，但此头衔不可用。请填写已获得的头衔，或在官方设置中选择。')
      if (nextUsername !== currentUsername) {
        const renamed = await changeUsername(currentUsername, session.key, nextUsername)
        if (!renamed.username) throw new Error('论坛没有返回修改后的用户名')
        currentUsername = renamed.username
        fresh = { ...fresh, username: currentUsername }
        lastUser.current = fresh
      }
      if (!alive.current) return
      onSaved(fresh)
      onClose()
      if (loadSession()?.key === session.key) saveSession({ ...session, username: currentUsername, name: fresh.name, avatarTemplate: fresh.avatar_template })
    } catch (err) {
      if (alive.current) setError(`${applied.current ? '部分资料可能已保存。' : ''}${errorMessage(err)}`)
    } finally { savingRef.current = false; if (alive.current) setBusy(false) }
  }

  return createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-3" onClick={close}>
    <section role="dialog" aria-modal="true" aria-label="修改资料" onClick={(event) => event.stopPropagation()} className="flex h-full max-h-[900px] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4"><h2 className="text-lg font-semibold text-ink">修改资料</h2><button ref={closeButton} onClick={close} disabled={busy} aria-label="关闭资料编辑" className="text-sub disabled:opacity-40">✕</button></div>
      <form onSubmit={(event) => { event.preventDefault(); void save() }} className="flex min-h-0 flex-1 flex-col">
        <div data-profile-editor-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset disabled={busy || loading} className="min-w-0 space-y-5 px-6 py-5 text-sm text-ink">
          <label className="block">用户名<input value={username} onChange={(event) => setUsername(event.target.value)} disabled={user.can_edit_username === false} className={fieldClass} /><span className="mt-1 block text-xs text-sub">其他人可以使用 @{username} 提及你{user.can_edit_username === false ? '；论坛暂不允许修改用户名' : ''}</span></label>
          <div><p>个人资料照片</p><div className="mt-2 flex items-center gap-4">{avatar ? <img src={avatar.url} alt="新头像预览" className="h-20 w-20 rounded-full object-cover" /> : <Avatar template={user.avatar_template} name={user.name || user.username} size={80} />}<label className="cursor-pointer rounded-lg border border-line px-3 py-2">上传头像<input type="file" accept="image/*" disabled={uploading || busy || user.can_edit_avatar === false || user.can_upload_avatar === false} onChange={(event) => { void upload(event.target.files?.[0], 'avatar'); event.target.value = '' }} className="sr-only" /></label>{avatar && <button type="button" onClick={() => setAvatar(null)} className="text-sub">撤销</button>}</div></div>
          <div className="grid gap-4 sm:grid-cols-2"><label>姓名<input value={name} onChange={(event) => setName(event.target.value)} disabled={user.can_edit_name === false} className={fieldClass} /></label><label>头衔<input value={title} onChange={(event) => setTitle(event.target.value)} className={fieldClass} /><span className="mt-1 block text-xs text-sub">仅可使用论坛已授予的头衔</span></label></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />隐藏我的公开个人资料</label>
          <label className="block">自我介绍<textarea value={bio} onChange={(event) => setBio(event.target.value)} disabled={user.can_change_bio === false} rows={5} placeholder="介绍一下自己，支持 Markdown" className={fieldClass} /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label>时区<input list="profile-timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" className={fieldClass} /><datalist id="profile-timezones">{['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles'].map((zone) => <option key={zone} value={zone} />)}</datalist><button type="button" onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)} className="mt-2 text-xs text-sub hover:text-ink">使用当前时区</button></label><label>地点<input value={location} onChange={(event) => setLocation(event.target.value)} disabled={user.can_change_location === false} className={fieldClass} /></label></div>
          <div><p>用户卡片背景</p>{background && <img src={imageUrl(background)} alt="用户卡片背景预览" className="mt-2 max-h-40 w-full rounded-lg object-cover" />}<div className="mt-2 flex gap-3"><label className="cursor-pointer rounded-lg border border-line px-3 py-2">上传背景<input type="file" accept="image/*" disabled={busy || uploading || user.can_upload_user_card_background === false} onChange={(event) => { void upload(event.target.files?.[0], 'card_background'); event.target.value = '' }} className="sr-only" /></label>{background && <button type="button" disabled={user.can_upload_user_card_background === false} onClick={() => setBackground('')} className="text-sub">移除背景</button>}</div></div>
          <label className="block">精选话题<input value={featured} onChange={(event) => setFeatured(event.target.value)} placeholder="填写话题编号或链接，留空取消精选" className={fieldClass} />{user.featured_topic && <span className="mt-1 block text-xs text-sub">当前：{user.featured_topic.title}</span>}</label>
          <a href={`https://forum.trae.cn/u/${encodeURIComponent(session.username)}/preferences/profile`} target="_blank" rel="noreferrer" className="inline-block text-xs text-sub hover:underline">前往官方资料设置</a>
        </fieldset>
        </div>
        <div className="shrink-0 border-t border-line px-6 py-4">{loading && <p role="status" className="mb-3 text-sm text-sub">{error ? <button type="button" onClick={() => setLoadVersion((value) => value + 1)} className="underline">重新加载资料</button> : '正在读取最新资料…'}</p>}{error && <p role="alert" className="mb-3 whitespace-pre-wrap text-sm text-red-600">{error}</p>}{uploading && <p role="status" className="mb-3 text-sm text-sub">图片上传中…</p>}<div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={close} className="px-4 py-2 text-sm text-sub">取消</button><button disabled={busy || uploading || loading} className="rounded-full bg-accent-fill px-5 py-2 text-sm text-white disabled:opacity-40">{busy ? '保存中…' : '保存修改'}</button></div></div>
      </form>
    </section>
  </div>, document.body)
}
