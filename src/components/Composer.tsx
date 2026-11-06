import MentionTextarea from './MentionTextarea'
﻿import { lockBodyScroll } from '../lib/scrollLock'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  createTopic,
  errorMessage,
  fetchCategories,
  fetchTags,
  getCachedCategories,
  getCachedTags,
  replyToPost,
  uploadImage,
  type CreatedPost,
} from '../api'
import type { AuthSession } from '../lib/auth'
import type { Category, TagItem } from '../types'
import EmojiPicker from './EmojiPicker'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { readDraft, saveDraft, clearDraft } from '../lib/draft'
import { ChevronDownIcon } from './icons'

interface ShellProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}

function ModalShell({ title, subtitle, onClose, children, fullscreen = false, onToggleFullscreen }: ShellProps) {
  useEffect(() => {
    return lockBodyScroll()
  }, [])
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onToggleFullscreen?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, onToggleFullscreen])
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className={`fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center ${fullscreen ? 'p-0' : 'p-0 sm:p-4'}`}>
      <div className={`w-full overflow-y-auto border border-line bg-surface p-6 ${fullscreen ? 'flex h-[100dvh] max-w-none flex-col' : 'max-h-[92vh] max-w-[600px] rounded-t-2xl sm:rounded-2xl'}`}>
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-1 text-[12px] text-sub">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {onToggleFullscreen && (
              <button type="button" onClick={onToggleFullscreen} aria-label={fullscreen ? '退出全屏' : '全屏编辑'}
                title={fullscreen ? '退出全屏（Esc）' : '全屏编辑'} aria-pressed={fullscreen}
                className="grid h-7 w-7 place-items-center rounded text-sub transition hover:bg-soft hover:text-ink">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <path d={fullscreen ? 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'} />
                </svg>
              </button>
            )}
            <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center text-sub hover:text-ink" aria-label="关闭">✕</button>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function ErrorBox({ error }: { error: string }) {
  if (!error) return null
  return (
    <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11.5px] leading-relaxed text-danger">
      {error}
    </pre>
  )
}

interface ReplyModalProps {
  session: AuthSession
  topicId: number
  replyTo?: { postNumber: number; username: string }
  onClose: () => void
  onSuccess: (post: CreatedPost) => void
}

export function ReplyModal({ session, topicId, replyTo, onClose, onSuccess }: ReplyModalProps) {
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!raw.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await replyToPost(session.key, {
        raw: raw.trim(),
        topic_id: topicId,
        ...(replyTo ? { reply_to_post_number: replyTo.postNumber } : {}),
      })
      setDone(`回复成功，楼层号 #${created.post_number ?? '—'}`)
      setRaw('')
      onSuccess(created)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={replyTo ? `回复 @${replyTo.username}` : '回复话题'}
      subtitle={`以 @${session.username} 的身份发布${replyTo ? ` · 引用第 ${replyTo.postNumber} 楼` : ''}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-4">
        <MentionTextarea apiKey={session?.key}
          value={raw}
          onValueChange={setRaw}
          rows={7}
          autoFocus
          placeholder="写下你的回复，支持 Markdown…"
          className="w-full resize-y rounded-xl border border-line bg-paper/50 px-3.5 py-3 text-[13.5px] leading-[1.7] text-ink outline-none focus:border-accent/40 focus:bg-surface"
        />
        <ErrorBox error={error} />
        {done && (
          <p className="mt-3 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-[12px] text-ok">
            {done}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-[12.5px] text-sub hover:text-ink">
            关闭
          </button>
          <button
            type="submit"
            disabled={busy || !raw.trim()}
            className="rounded-full bg-btn px-5 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '发布中…' : '发布回复'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

interface NewTopicModalProps {
  session: AuthSession | null
  onClose: () => void
  onSuccess: (post: CreatedPost) => void
  onRequireLogin: () => void
}

function ToolbarButton({
  label,
  onClick,
  title,
  disabled,
}: {
  label: ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="grid h-7 min-w-7 place-items-center rounded px-1.5 text-[12.5px] text-sub transition hover:bg-soft hover:text-ink disabled:opacity-40"
    >
      {label}
    </button>
  )
}

export function NewTopicModal({ session, onClose, onSuccess, onRequireLogin }: NewTopicModalProps) {
  const initialDraft = useRef(session ? readDraft(session.username) : null)
  const publishedRef = useRef(false)
  const [draftStatus, setDraftStatus] = useState(initialDraft.current ? '已恢复本地草稿' : '')
  const [fullscreen, setFullscreen] = useState(false)
  const [categories, setCategories] = useState<Category[]>(() => getCachedCategories() ?? [])
  const [categoryId, setCategoryId] = useState<number | null>(initialDraft.current?.categoryId ?? null)
  const [catOpen, setCatOpen] = useState(false)
  const [title, setTitle] = useState(initialDraft.current?.title ?? '')
  const [raw, setRaw] = useState(initialDraft.current?.raw ?? '')
  const [tags, setTags] = useState<string[]>(initialDraft.current?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [allTags, setAllTags] = useState<TagItem[]>(() => getCachedTags() ?? [])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetchCategories()
      .then((list) => {
        if (!alive) return
        setCategories(list)
        setCategoryId((prev) => prev ?? list.find((item) => !item.read_restricted)?.id ?? null)
      })
      .catch(() => {
        // 分类失败时仍允许自由填写正文；不打断编辑
      })
    fetchTags()
      .then((list) => {
        if (alive) setAllTags(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const draft = { title, raw, categoryId, tags }
  const draftRef = useRef(draft)
  draftRef.current = draft
  const persistDraft = () => {
    if (!session || publishedRef.current) return
    setDraftStatus(saveDraft(session.username, draftRef.current) ? '本地草稿已保存' : '保存失败，请检查浏览器存储空间')
  }
  useEffect(() => {
    if (!session || publishedRef.current) return
    const saved = saveDraft(session.username, { title, raw, categoryId, tags })
    setDraftStatus(saved ? (title || raw || tags.length ? '本地草稿已自动保存' : '') : '本地草稿保存失败')
  }, [title, raw, categoryId, tags, session?.username])
  useEffect(() => {
    if (!session) return
    const flush = () => {
      if (!publishedRef.current) saveDraft(session.username, draftRef.current)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [session?.username])
  const closeEditor = () => {
    persistDraft()
    onClose()
  }
  const previewHtml = useMemo(() => DOMPurify.sanitize(marked.parse(raw, { async: false, gfm: true, breaks: true })), [raw])

  const postable = categories.filter((category) => !category.read_restricted)
  const selectedCategory = categories.find((category) => category.id === categoryId) || null

  const suggestions = useMemo(() => {
    const keyword = tagInput.trim().replace(/^#/, '').toLowerCase()
    return allTags
      .filter((tag) => !tags.includes(tag.name))
      .filter((tag) => (keyword ? tag.name.toLowerCase().includes(keyword) : true))
      .slice(0, 8)
  }, [allTags, tags, tagInput])

  const insertText = (text: string, cursor?: number) => {
    const el = bodyRef.current
    if (!el) {
      setRaw((prev) => prev + text)
      return
    }
    const start = el.selectionStart ?? raw.length
    const end = el.selectionEnd ?? start
    const current = el.value
    const next = current.slice(0, start) + text + current.slice(end)
    setRaw(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + (cursor ?? text.length)
      el.setSelectionRange(pos, pos)
    })
  }

  const wrap = (before: string, after: string, placeholder: string) => {
    const el = bodyRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    const body = raw.slice(start, end) || placeholder
    insertText(before + body + after, before.length + body.length)
  }

  const addTag = (name: string) => {
    const value = name.trim().replace(/^#/, '')
    if (!value) return
    setTags((prev) => (prev.includes(value) || prev.length >= 5 ? prev : [...prev, value]))
    setTagInput('')
  }

  const uploadFile = async (file: File) => {
    if (!session) return
    setUploading(true)
    setError('')
    try {
      const result = await uploadImage(session.key, file)
      insertText(`![${file.name.replace(/[\[\]()`]/g, '-')}](${result.url})\n`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!session) {
      onRequireLogin()
      return
    }
    if (!title.trim() || !raw.trim()) {
      setError('标题和正文都不能为空')
      return
    }
    if (!categoryId) {
      setError('请选择分类')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await createTopic(session.key, {
        title: title.trim(),
        raw: raw.trim(),
        category: categoryId,
        ...(tags.length ? { tags } : {}),
      })
      setDone(`发帖成功，话题 ID：${created.topic_id ?? created.id}`)
      publishedRef.current = true
      clearDraft(session.username)
      onSuccess(created)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="发布"
      fullscreen={fullscreen}
      onToggleFullscreen={() => setFullscreen((value) => !value)}
      subtitle={session ? `以 @${session.username} 的身份发布` : '登录后即可发布'}
      onClose={closeEditor}
    >
      <div className={`relative ${fullscreen ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
        {!session && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface/75">
            <p className="text-[13px] text-sub">登录后即可发布话题</p>
            <button
              type="button"
              onClick={onRequireLogin}
              className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition hover:opacity-90"
            >
              去登录
            </button>
          </div>
        )}
        <div className={fullscreen ? 'mt-4 grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden' : ''}>
        <form onSubmit={submit} className={`mt-4 ${fullscreen ? 'flex min-h-[480px] flex-col lg:min-h-0 [&>*]:shrink-0' : ''} ${session ? '' : 'pointer-events-none opacity-60'}`}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="填写标题会更受欢迎"
          className="w-full border-0 bg-transparent px-0.5 text-[19px] font-semibold text-ink outline-none placeholder:text-sub/70"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-line/70 py-2.5">
          {/* 类别下拉：色块 + 名称，只列出可发帖分类 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setCatOpen((value) => !value)}
              aria-label="选择分类"
              className="flex items-center gap-1.5 rounded-full bg-soft px-3 py-1.5 text-[12px] text-ink transition hover:bg-soft/80"
            >
              {selectedCategory ? (
                <>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: selectedCategory.color || 'var(--sub)' }}
                  />
                  {selectedCategory.name}
                </>
              ) : (
                '选择分类'
              )}
              <ChevronDownIcon className="h-3 w-3 text-sub" />
            </button>
            {catOpen && (
              <div className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-[240px] w-[220px] overflow-y-auto rounded-xl border border-line bg-surface-2 p-1.5">
                {!postable.length && (
                  <p className="px-2 py-2 text-[11.5px] text-sub">分类加载中…</p>
                )}
                {postable.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(category.id)
                      setCatOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition ${
                      category.id === categoryId ? 'bg-soft text-ink' : 'text-sub hover:bg-soft/60 hover:text-ink'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: category.color || 'var(--sub)' }}
                    />
                    <span
                      className={`truncate ${category.parent_category_id ? 'pl-2' : ''}`}
                    >
                      {category.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 标签输入：回车或点「+」新增，浅胶囊可删除 */}
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-soft px-2.5 py-1 text-[11.5px] text-ink"
            >
              #{tag}
              <button
                type="button"
                onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}
                className="text-sub hover:text-ink"
                aria-label={`移除标签 ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
          <div className="flex min-w-[120px] max-w-[280px] flex-1 items-center gap-1 rounded-full bg-soft px-2.5 py-1">
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTag(tagInput)
                }
              }}
              placeholder="添加标签"
              className="min-w-0 flex-1 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-sub/80"
            />
            <button
              type="button"
              onClick={() => addTag(tagInput)}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-sub transition hover:bg-surface hover:text-ink"
              aria-label="新增标签"
            >
              +
            </button>
          </div>
        </div>

        {tagInput && suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() => addTag(tag.name)}
                className="rounded-full px-2 py-0.5 text-[11.5px] text-sub transition hover:bg-soft hover:text-ink"
              >
                #{tag.name}
              </button>
            ))}
          </div>
        )}

        <MentionTextarea apiKey={session?.key}
          ref={bodyRef}
          value={raw}
          onValueChange={setRaw}
          rows={9}
          onPaste={(event) => {
            const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
            if (image && !uploading) { event.preventDefault(); void uploadFile(image) }
          }}
          placeholder="分享你的经验、问题或发现…"
          className={`mt-3 w-full border-0 bg-transparent px-0.5 text-[13.5px] leading-[1.75] text-ink outline-none placeholder:text-sub/80 ${fullscreen ? 'min-h-32 flex-1 !shrink resize-none' : 'resize-y'}`}
        />

        <div className="mt-1 flex flex-wrap items-center gap-0.5 border-t border-line/70 pt-2">
          <ToolbarButton label={<span className="font-semibold">B</span>} title="粗体" onClick={() => wrap('**', '**', '粗体')} />
          <ToolbarButton label={<span className="italic">I</span>} title="斜体" onClick={() => wrap('*', '*', '斜体')} />
          <ToolbarButton label="链接" title="插入链接" onClick={() => wrap('[', '](url)', '链接文字')} />
          <ToolbarButton label="引用" title="引用" onClick={() => insertText('> ')} />
          <ToolbarButton label="列表" title="无序列表" onClick={() => insertText('- ')} />
          <ToolbarButton
            label={uploading ? '上传中…' : '图片'}
            title="上传图片"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          />
          <ToolbarButton label="表情" title="插入表情" onClick={() => setEmojiOpen((value) => !value)} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void uploadFile(file)
            }}
          />
          <span className="ml-auto text-[10.5px] text-sub/80">支持 Markdown</span>
        </div>

        {emojiOpen && (
          <EmojiPicker
            open={emojiOpen}
            onClose={() => setEmojiOpen(false)}
            onInsert={(text) => insertText(text)}
          />
        )}

        <ErrorBox error={error} />
        {done && (
          <p className="mt-3 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-[12px] text-ok">
            {done}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <span role="status" className="mr-auto text-[11px] text-sub">{draftStatus}</span>
          <button type="button" disabled={!session || busy} onClick={persistDraft} className="px-3 py-2 text-[12.5px] text-sub hover:text-ink disabled:opacity-40">保存草稿</button>
          <button type="button" onClick={closeEditor} className="px-3 py-2 text-[12.5px] text-sub hover:text-ink">
            关闭
          </button>
          <button
            type="submit"
            disabled={busy || uploading}
            className="rounded-full bg-btn px-5 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '发布中…' : '发布'}
          </button>
        </div>
      </form>
      {fullscreen && (
        <aside aria-label="实时预览" className="flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-line bg-paper/30 lg:min-h-0">
          <div className="shrink-0 border-b border-line px-5 py-3 text-[12px] text-sub">实时预览</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
            {title && <h2 className="mb-4 break-words text-xl font-semibold text-ink">{title}</h2>}
            {raw ? <div className="post-body break-words [&_img]:max-w-full [&_img]:rounded-lg [&_pre]:overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: previewHtml }} />
              : <p className="text-sm text-sub">输入正文或上传图片后，这里会实时显示预览。</p>}
          </div>
        </aside>
      )}
      </div>
      </div>
    </ModalShell>
  )
}
