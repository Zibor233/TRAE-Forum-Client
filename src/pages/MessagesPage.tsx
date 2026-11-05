import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import Avatar from '../components/Avatar'
import { openUserCard } from '../lib/userCard'
import EmptyState from '../components/EmptyState'
import RateLimitState from '../components/RateLimitState'
import EmojiPicker from '../components/EmojiPicker'
import { BackIcon, ChatIcon, EmojiIcon, SendIcon } from '../components/icons'
import { AUTH_EVENT, type AuthSession } from '../lib/auth'
import {
  ApiError,
  uploadImage,
  fetchUserProfile,
  editChatMessage,
  deleteChatMessage,
  pinChatMessage,
  rebakeChatMessage,
  errorMessage,
  fetchChatChannels,
  fetchChatMessages,
  fetchChatOverview,
  peekChatOverview,
  peekChatChannels,
  sendChatMessage,
} from '../api'
import { absolutize, sanitizeCooked, timeAgo } from '../lib/format'
import type { ChatChannel, ChatMessage, ChatUpload } from '../types'

interface MessagesPageProps {
  session: AuthSession | null
  onRequireLogin: () => void
  initialChannelId?: number
  /** 从私信话题跳转过来时，按对方用户名定位私信频道 */
  initialDmUsername?: string
  onSelectChannel: (channelId: number | null) => void
}

type LoadState = 'idle' | 'loading' | 'error'

interface Peer {
  username: string
  name: string
  avatarTemplate?: string
}

function isPrivateMessage(channel: ChatChannel) {
  return channel.chatable_type === 'DirectMessage' || Boolean(channel.chatable?.users?.length)
}

/** 私信频道里的「对方」 */
function peerOf(channel: ChatChannel, selfUsername: string): Peer | null {
  const peer = channel.chatable?.users?.find((user) => user.username !== selfUsername)
  if (peer) {
    return {
      username: peer.username,
      name: peer.name?.trim() || peer.username,
      avatarTemplate: peer.avatar_template,
    }
  }
  if (isPrivateMessage(channel)) {
    const fallback = channel.title?.trim()
    if (fallback && fallback !== selfUsername) {
      return { username: fallback, name: fallback }
    }
  }
  return null
}

function channelName(channel: ChatChannel, selfUsername: string) {
  const peer = peerOf(channel, selfUsername)
  return peer?.name || channel.title?.trim() || channel.unicode_title?.trim() || '对话'
}

function channelAvatar(channel: ChatChannel, selfUsername: string) {
  const peer = peerOf(channel, selfUsername)
  return { template: peer?.avatarTemplate, name: peer?.name || channel.title || '频道' }
}

function sortMessages(list: ChatMessage[]) {
  return [...list].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    return diff || a.id - b.id
  })
}

function mergeMessages(prev: ChatMessage[], next: ChatMessage[]) {
  const map = new Map<number, ChatMessage>()
  for (const item of prev) map.set(item.id, item)
  for (const item of next) map.set(item.id, item)
  return sortMessages([...map.values()])
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}

/** 气泡里的时间：当天只显示时分，跨天带日期；同分钟由外层合并 */
function bubbleTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return sameDay
    ? hm
    : `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`
}

function chatLoadError(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return `请求较频繁，请${err.retryAfter ? `约 ${err.retryAfter} 秒后` : '稍后'}重试`
  if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return '暂时没有访问权限，请检查登录授权'
  if (err instanceof DOMException && err.name === 'TimeoutError') return '加载超时，请稍后重试'
  return '连接暂时失败，请稍后重试'
}

function minuteKey(iso: string) {
  return iso.slice(0, 16)
}

export default function MessagesPage({
  session,
  onRequireLogin,
  initialChannelId,
  initialDmUsername,
  onSelectChannel,
}: MessagesPageProps) {
  const sessionKey = session?.key ?? ''
  const selfUsername = session?.username ?? ''

  const [dms, setDms] = useState<ChatChannel[]>([])
  const [channels, setChannels] = useState<ChatChannel[]>([])
  const [listStatus, setListStatus] = useState<LoadState>('loading')
  const [channelStatus, setChannelStatus] = useState<LoadState>('loading')
  const [channelError, setChannelError] = useState('')
  const [msgError, setMsgError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [channelsOpen, setChannelsOpen] = useState(true)

  const [selectedId, setSelectedId] = useState<number | null>(initialChannelId ?? null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [msgStatus, setMsgStatus] = useState<LoadState>('idle')
  const [msgReloadKey, setMsgReloadKey] = useState(0)
  const [hasMorePast, setHasMorePast] = useState(false)
  const [loadingPast, setLoadingPast] = useState(false)

  const [raw, setRaw] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const userTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [userMenu, setUserMenu] = useState<{ username: string; x: number; y: number } | null>(null)

  const openUserMenu = (event: ReactMouseEvent<HTMLButtonElement>, username: string) => {
    const anchor = event.currentTarget
    const rect = anchor.getBoundingClientRect()
    userTriggerRef.current = anchor
    setUserMenu((prev) => prev?.username === username ? null : {
      username,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 200)),
      y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 112)),
    })
  }

  useEffect(() => { setUserMenu(null) }, [selectedId, sessionKey])
  useEffect(() => {
    if (!userMenu) return
    userMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !userMenuRef.current?.contains(event.target) &&
          !(event.target instanceof Element && event.target.closest('[data-chat-user]'))) setUserMenu(null)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenu(null)
        userTriggerRef.current?.focus()
      }
    }
    const close = () => setUserMenu(null)
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    window.addEventListener('resize', close)
    const body = bodyRef.current
    body?.addEventListener('scroll', close)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('resize', close)
      body?.removeEventListener('scroll', close)
    }
  }, [userMenu])

  const mentionUser = (username: string) => {
    const input = composerRef.current
    const start = input?.selectionStart ?? raw.length
    const end = input?.selectionEnd ?? start
    const prefix = start > 0 && !/\s/.test(raw[start - 1]) ? ' ' : ''
    const mention = `${prefix}@${username} `
    setRaw(raw.slice(0, start) + mention + raw.slice(end))
    setUserMenu(null)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(start + mention.length, start + mention.length)
    })
  }

  const [attachments, setAttachments] = useState<ChatUpload[]>([])
  const [uploading, setUploading] = useState(false)
  const uploadBusy = useRef(false)
  const uploadVersion = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [messageMenu, setMessageMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const messageMenuRef = useRef<HTMLDivElement>(null)
  const openMessageMenu = (message: ChatMessage, x: number, y: number) => {
    setUserMenu(null)
    setMessageMenu((prev) => prev?.id === message.id ? null : {
      id: message.id, x: Math.max(8, Math.min(x, window.innerWidth - 208)),
      y: Math.max(8, Math.min(y, window.innerHeight - 280)),
    })
  }
  useEffect(() => {
    if (!messageMenu) return
    messageMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !messageMenuRef.current?.contains(event.target) &&
          !(event.target instanceof Element && event.target.closest('[data-message-actions]'))) setMessageMenu(null)
    }
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { setMessageMenu(null); document.getElementById(`chat-bubble-${messageMenu.id}`)?.focus() }
    }
    const close = () => setMessageMenu(null)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key)
      window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true)
    }
  }, [messageMenu])
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set())
  const [actionBusy, setActionBusy] = useState(false)
  const [actionNotice, setActionNotice] = useState('')
  const [canModerate, setCanModerate] = useState(false)
  const [hasMoreFuture, setHasMoreFuture] = useState(false)
  const olderBusy = useRef(false)
  useEffect(() => {
    if (!sessionKey) return
    const controller = new AbortController()
    setCanModerate(false)
    fetchUserProfile(selfUsername, sessionKey, controller.signal).then((user) => {
      setCanModerate(Boolean(user.admin || user.moderator))
    }).catch(() => undefined)
    return () => controller.abort()
  }, [sessionKey, selfUsername])
  useEffect(() => {
    uploadVersion.current += 1
    uploadBusy.current = false
    setUploading(false)
    setAttachments([])
    setEditing(null)
    setMessageMenu(null)
    setSelectedMessages(new Set())
    setActionNotice('')
    return () => { uploadVersion.current += 1 }
  }, [selectedId, sessionKey])
  const uploadChatImages = async (files: File[]) => {
    if (uploadBusy.current || !sessionKey || selectedId == null) return
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (!images.length) return
    uploadBusy.current = true
    setUploading(true)
    setSendError('')
    const version = uploadVersion.current
    try {
      for (const file of images) {
        const result = await uploadImage(sessionKey, file)
        if (version !== uploadVersion.current) return
        if (!result.id) throw new Error('图片上传未返回附件 ID，请重试')
        setAttachments((prev) => [...prev, { id: result.id!, url: result.url, original_filename: file.name }])
      }
    } catch (err) {
      if (version === uploadVersion.current) setSendError(errorMessage(err))
    } finally {
      if (version === uploadVersion.current) { uploadBusy.current = false; setUploading(false) }
    }
  }
  const messageLink = (message: ChatMessage) => `https://forum.trae.cn/chat/c/-/${message.chat_channel_id || selectedId}/${message.id}`
  const runMessageAction = async (message: ChatMessage, action: 'copy' | 'delete' | 'pin' | 'rebake') => {
    if (actionBusy || selectedId == null) return
    const channelId = selectedId
    setActionBusy(true)
    setMessageMenu(null)
    setActionNotice('')
    try {
      if (action === 'copy') {
        await navigator.clipboard.writeText(messageLink(message))
        setActionNotice('消息链接已复制')
      } else if (action === 'delete') {
        if (!window.confirm('确定删除这条消息？')) return
        await deleteChatMessage(channelId, message.id, sessionKey)
        if (selectedRef.current === channelId) setMessages((prev) => prev.filter((item) => item.id !== message.id))
      } else if (action === 'pin') {
        await pinChatMessage(channelId, message.id, sessionKey, !message.pinned)
        if (selectedRef.current === channelId) setMessages((prev) => prev.map((item) => item.id === message.id ? { ...item, pinned: !item.pinned } : item))
      } else {
        await rebakeChatMessage(channelId, message.id, sessionKey)
        const data = await fetchChatMessages(channelId, sessionKey, { aroundId: message.id, pageSize: 50 })
        if (selectedRef.current === channelId) setMessages((prev) => mergeMessages(prev, data.messages || []))
        setActionNotice('消息 HTML 已重建')
      }
    } catch (err) { setActionNotice(errorMessage(err)) }
    finally { setActionBusy(false) }
  }

  const bodyRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<number | null>(selectedId)

  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])

  // 私信 + 公开频道：一次登录请求拿到私信，另取公开频道（含未加入的）
  useEffect(() => {
    if (!sessionKey) {
      setDms([])
      setChannels([])
      setChannelStatus('idle')
      setChannelError('')
      setListStatus('idle')
      return
    }
    const controller = new AbortController()
    let alive = true

    const cachedOverview = peekChatOverview(sessionKey)
    const cachedChannels = peekChatChannels(sessionKey)
    setDms(cachedOverview?.direct_message_channels || [])
    setChannels(cachedChannels || [])
    setListStatus(cachedOverview ? 'idle' : 'loading')
    setChannelStatus('loading')
    setChannelError('')

    // 两条请求互不阻塞，一条失败不能丢弃另一条成功的结果。
    fetchChatOverview(sessionKey, controller.signal)
      .then((overview) => {
        if (!alive) return
        setDms(overview.direct_message_channels || [])
        setListStatus('idle')
      })
      .catch(() => {
        if (alive) setListStatus(cachedOverview ? 'idle' : 'error')
      })
    fetchChatChannels(sessionKey, controller.signal)
      .then((allChannels) => {
        if (!alive) return
        setChannels(allChannels)
        setChannelStatus('idle')
      })
      .catch((err) => {
        if (!alive) return
        setChannelStatus('error')
        setChannelError(chatLoadError(err))
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [sessionKey, reloadKey])

  // 登录/退出后自动恢复，无需刷新页面
  useEffect(() => {
    const onAuthChanged = () => setReloadKey((value) => value + 1)
    window.addEventListener(AUTH_EVENT, onAuthChanged)
    return () => window.removeEventListener(AUTH_EVENT, onAuthChanged)
  }, [])

  // 从私信话题跳过来：按对方用户名定位对应私信频道
  useEffect(() => {
    if (!initialDmUsername || selectedRef.current != null || !dms.length) return
    const target = dms.find(
      (channel) => peerOf(channel, selfUsername)?.username === initialDmUsername,
    )
    if (target) {
      setSelectedId(target.id)
      selectedRef.current = target.id
      onSelectChannel(target.id)
    }
  }, [dms, initialDmUsername, selfUsername, onSelectChannel])

  // 当前频道消息：首次取最新一页，进入后滚动到最新
  useEffect(() => {
    if (!sessionKey || selectedId == null) {
      setMessages([])
      setMsgStatus('idle')
      setHasMorePast(false)
      return
    }
    const controller = new AbortController()
    let alive = true
    setMessages([])
    setMsgStatus('loading')
    setMsgError('')
    setHasMorePast(false)
    setRaw('')
    setSendError('')

    fetchChatMessages(selectedId, sessionKey, { pageSize: 50 }, controller.signal)
      .then((data) => {
        if (!alive) return
        setMessages(sortMessages(data.messages || []))
        setHasMorePast(Boolean(data.meta?.can_load_more_past))
        setHasMoreFuture(Boolean(data.meta?.can_load_more_future))
        setMsgStatus('idle')
      })
      .catch((err) => {
        if (!alive) return
        setMessages([])
        setMsgError(chatLoadError(err))
        setMsgStatus('error')
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [sessionKey, selectedId, msgReloadKey])

  // 首次进入 / 发送后定位到最新
  useEffect(() => {
    if (msgStatus !== 'idle') return
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgStatus, selectedId])

  // 向上滚动加载更早消息，并保持当前阅读位置不跳动
  const loadOlder = useCallback(async () => {
    const el = bodyRef.current
    if (!el || olderBusy.current || loadingPast || !hasMorePast || msgStatus !== 'idle') return
    if (selectedRef.current == null || !messages.length) return
    const channelId = selectedRef.current
    const beforeId = messages[0].id
    const prevHeight = el.scrollHeight
    const prevTop = el.scrollTop
    olderBusy.current = true
    setLoadingPast(true)
    try {
      const data = await fetchChatMessages(channelId, sessionKey, {
        beforeId,
        pageSize: 50,
      })
      if (selectedRef.current !== channelId) return
      const older = (data.messages || []).filter((item) => item.id < beforeId)
      if (!older.length) {
        setHasMorePast(false)
        return
      }
      setMessages((prev) => mergeMessages(prev, older))
      setHasMorePast(Boolean(data.meta?.can_load_more_past))
      requestAnimationFrame(() => {
        const node = bodyRef.current
        if (node) node.scrollTop = node.scrollHeight - prevHeight + prevTop
      })
    } catch {
      // 向上翻页失败不弹错，保留「加载更多」按钮可重试
      setHasMorePast(true)
    } finally {
      olderBusy.current = false
      setLoadingPast(false)
    }
  }, [hasMorePast, loadingPast, messages, msgStatus, sessionKey])

  const patchLastMessage = (channelId: number, message: ChatMessage) => {
    const patch = (list: ChatChannel[]) =>
      list.map((channel) =>
        channel.id === channelId ? { ...channel, last_message: message } : channel,
      )
    setDms(patch)
    setChannels(patch)
  }

  const openChannel = (channelId: number) => {
    setSelectedId(channelId)
    selectedRef.current = channelId
    setRaw('')
    setSendError('')
    setEmojiOpen(false)
    onSelectChannel(channelId)
  }

  const backToList = () => {
    setSelectedId(null)
    selectedRef.current = null
    setRaw('')
    setSendError('')
    setEmojiOpen(false)
    onSelectChannel(null)
  }

  const send = async () => {
    if (sending || uploading || selectedId == null || (!raw.trim() && !attachments.length)) return
    const channelId = selectedId
    const text = raw.trim()
    setSending(true)
    setSendError('')
    try {
      const result = editing
        ? await editChatMessage(channelId, editing.id, sessionKey, text, attachments.map((item) => item.id)) as { message_id?: number; id?: number }
        : await sendChatMessage(channelId, sessionKey, text, attachments.map((item) => item.id))
      const id = result.message_id ?? result.id ?? 0
      const message: ChatMessage = {
        id: editing?.id || id || -(Date.now()),
        uploads: attachments,
        edited: Boolean(editing),
        message: text,
        cooked: `<p>${escapeHtml(text)}</p>`,
        created_at: new Date().toISOString(),
        chat_channel_id: channelId,
        user: {
          id: 0,
          username: selfUsername,
          name: session?.name,
          avatar_template: session?.avatarTemplate,
        },
      }
      if (selectedRef.current === channelId) {
        setMessages((prev) => mergeMessages(prev, [message]))
        setRaw('')
        setAttachments([])
        setEditing(null)
        requestAnimationFrame(() => { const body = bodyRef.current; if (body) body.scrollTop = body.scrollHeight })
      }
      patchLastMessage(channelId, message)
      // 使用论坛处理过的 HTML 替换本地临时内容，保留图片、提及与格式。
      const savedId = editing?.id || id
      if (savedId) {
        fetchChatMessages(channelId, sessionKey, { aroundId: savedId }).then((data) => {
          if (selectedRef.current === channelId) setMessages((prev) => mergeMessages(prev, data.messages || []))
        }).catch(() => undefined)
      }
    } catch (err) {
      setSendError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  if (!session?.key) {
    return (
      <EmptyState
        icon={<ChatIcon className="h-7 w-7" />}
        title="登录后查看消息"
        description="私信与频道需要论坛登录；未登录不会发起任何请求。"
        onLogin={onRequireLogin}
      />
    )
  }

  if (listStatus === 'error') {
    return (
      <div className="py-6">
        <RateLimitState onRetry={() => setReloadKey((value) => value + 1)} />
      </div>
    )
  }

  const activeChannel =
    dms.find((channel) => channel.id === selectedId) ||
    channels.find((channel) => channel.id === selectedId) ||
    null
  const activePeer = activeChannel ? peerOf(activeChannel, selfUsername) : null
  const activeIsDm = activeChannel ? isPrivateMessage(activeChannel) : false
  const headerAvatar = activeChannel
    ? channelAvatar(activeChannel, selfUsername)
    : { template: undefined, name: '' }

  const renderListItem = (channel: ChatChannel) => {
    const peer = peerOf(channel, selfUsername)
    const avatar = channelAvatar(channel, selfUsername)
    const last = channel.last_message
    const lastText = last?.message || last?.excerpt || '还没有消息'
    const unreadId = channel.current_user_membership?.last_read_message_id
    const unread = Boolean(last?.id && unreadId && last.id > unreadId)
    return (
      <button
        key={channel.id}
        onClick={() => openChannel(channel.id)}
        className={`flex w-full items-center gap-2.5 px-4 py-3 text-left transition ${
          selectedId === channel.id ? 'bg-soft' : 'hover:bg-soft/60'
        }`}
      >
        <div className="relative shrink-0">
          <Avatar template={avatar.template} name={avatar.name} size={38} />
          {unread && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#ff2442]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
              {channelName(channel, selfUsername)}
            </span>
            <span className="shrink-0 text-[10.5px] text-sub">
              {last?.created_at ? timeAgo(last.created_at) : ''}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-sub">{lastText}</p>
        </div>
      </button>
    )
  }

  return (
    <div className="pt-3">
      {/* 一体式布局：无卡片外框、无圆角阴影，左右贴边铺满可视区域 */}
      <div className="flex h-[calc(100vh-36px)] min-h-[420px] flex-col bg-surface md:flex-row">
        {/* 左栏：私信 + 频道（桌面固定 300px，仅一条极浅分隔线） */}
        <aside
          className={`min-h-0 w-full flex-col md:w-[300px] md:shrink-0 md:border-r md:border-line/70 ${
            selectedId != null ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="flex shrink-0 items-center gap-2 px-4 py-3.5">
            <ChatIcon className="h-4 w-4 text-[#ff2442]" />
            <span className="text-[13px] font-medium text-ink">消息</span>
            {listStatus === 'loading' && (
              <span className="ml-auto h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            <p className="px-4 pb-1 pt-3 text-[11px] font-medium tracking-wide text-sub">私信</p>
            {listStatus === 'idle' && !dms.length && (
              <p className="px-4 py-2 text-[11.5px] text-sub">暂无私信</p>
            )}
            {dms.map(renderListItem)}

            <button
              onClick={() => setChannelsOpen((value) => !value)}
              className="mt-1 flex w-full items-center gap-1 px-4 pb-1 pt-3 text-left text-[11px] font-medium tracking-wide text-sub"
            >
              频道
              <svg
                viewBox="0 0 24 24"
                className={`h-3 w-3 transition ${channelsOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {channelsOpen && (
              <>
                {channelStatus === 'loading' && <p className="px-4 py-2 text-[11.5px] text-sub">频道加载中…</p>}
                {channelStatus === 'error' && (
                  <div className="px-4 py-2 text-[11.5px] text-sub">
                    <p>{channelError}{channels.length ? '，正在显示上次结果' : ''}</p>
                    <button onClick={() => setReloadKey((value) => value + 1)} className="mt-1 underline underline-offset-2">重新加载频道</button>
                  </div>
                )}
                {channelStatus === 'idle' && !channels.length && (
                  <p className="px-4 py-2 text-[11.5px] text-sub">暂无公开频道</p>
                )}
                {channels.map(renderListItem)}
              </>
            )}
          </div>
        </aside>

        {/* 右栏：对话区 */}
        <section
          className={`min-h-0 min-w-0 flex-1 flex-col ${
            selectedId != null ? 'flex' : 'hidden md:flex'
          }`}
        >
          {activeChannel ? (
            <>
              <div className="flex shrink-0 items-center gap-2.5 border-b border-line/70 px-4 py-3">
                <button
                  onClick={backToList}
                  aria-label="返回"
                  className="grid h-7 w-7 place-items-center rounded-full text-sub hover:bg-paper md:hidden"
                >
                  <BackIcon className="h-4 w-4" />
                </button>
                <a
                  href={activeIsDm && activePeer?.username ? `#/u/${encodeURIComponent(activePeer.username)}` : undefined}
                  aria-label={activeIsDm && activePeer ? `查看 ${activePeer.name} 的主页` : undefined}
                  title={activeIsDm && activePeer ? '查看主页' : undefined}
                  className={`flex min-w-0 items-center gap-2.5 rounded-lg ${activeIsDm && activePeer ? 'transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent' : ''}`}
                >
                  <Avatar template={headerAvatar.template} name={headerAvatar.name} size={34} />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-ink">
                      {channelName(activeChannel, selfUsername)}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-sub">
                      {activeIsDm
                        ? `私信 · @${activePeer?.username || activeChannel.title || ''}`
                        : `频道${activeChannel.memberships_count ? ` · ${activeChannel.memberships_count} 成员` : ''}`}
                    </p>
                  </div>
                </a>
              </div>

              <div
                ref={bodyRef}
                onScroll={(event) => {
                  if (event.currentTarget.scrollTop < 48) void loadOlder()
                }}
                className="min-h-0 flex-1 overflow-y-auto px-3 py-2 md:px-5"
              >
                {msgStatus === 'loading' && (
                  <div className="grid h-full place-items-center">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" />
                  </div>
                )}

                {msgStatus === 'error' && (
                  <div className="grid h-full place-items-center px-4 text-center">
                    <div className="text-center text-[13px] text-sub">
                      <p>{msgError || '聊天暂时无法加载'}</p>
                      <button onClick={() => setMsgReloadKey((value) => value + 1)} className="mt-3 rounded-full border border-line px-4 py-2 hover:text-ink">重新加载</button>
                    </div>
                  </div>
                )}

                {msgStatus === 'idle' && (
                  <>
                    {(hasMorePast || loadingPast) && (
                      <div className="pb-1 text-center">
                        {loadingPast ? (
                          <span className="text-[11px] text-sub">加载更早消息…</span>
                        ) : (
                          <button
                            onClick={() => void loadOlder()}
                            className="text-[11px] text-sub underline-offset-2 hover:underline"
                          >
                            加载更早消息
                          </button>
                        )}
                      </div>
                    )}

                    {!messages.length && (
                      <p className="py-8 text-center text-[12px] text-sub">
                        还没有消息，打个招呼吧
                      </p>
                    )}

                    {messages.map((message, index) => {
                      const mine = message.user.username === selfUsername
                      const prev = messages[index - 1]
                      const sameMinute =
                        prev &&
                        prev.user.username === message.user.username &&
                        minuteKey(prev.created_at) === minuteKey(message.created_at)
                      const sameSender = prev && prev.user.username === message.user.username
                      const newMinute = !prev || minuteKey(prev.created_at) !== minuteKey(message.created_at)
                      const showAvatar = !mine && !sameMinute
                      const html = sanitizeCooked(message.cooked || escapeHtml(message.message))
                      return (
                        <div key={message.id} id={`chat-message-${message.id}`} className={selectedMessages.has(message.id) ? 'rounded-lg bg-accent/10' : ''}>
                          {newMinute && (
                            <div className="my-2 text-center text-[10.5px] text-sub">
                              {bubbleTime(message.created_at)}
                            </div>
                          )}
                          <div
                            className={`flex items-start gap-2 ${mine ? 'justify-end' : 'justify-start'} ${
                              sameSender ? 'mt-1' : 'mt-3'
                            }`}
                          >
                            {!mine && (
                              <div className="w-7 shrink-0 self-start">
                                {showAvatar && (
                                  <button type="button" data-chat-user aria-label={`@${message.user.username} 的操作`}
                                    aria-expanded={userMenu?.username === message.user.username}
                                    onClick={(event) => openUserMenu(event, message.user.username)}
                                    className="block rounded-full transition hover:opacity-80">
                                  <Avatar
                                    template={message.user.avatar_template}
                                    name={message.user.name || message.user.username}
                                    size={28}
                                  />
                                  </button>
                                )}
                              </div>
                            )}
                            <div
                              className={`flex min-w-0 max-w-[78%] flex-col ${
                                mine ? 'items-end' : 'items-start'
                              }`}
                            >
                              {!mine && !sameMinute && !activeIsDm && (
                                <button type="button" data-chat-user
                                  aria-expanded={userMenu?.username === message.user.username}
                                  onClick={(event) => openUserMenu(event, message.user.username)}
                                  className="mb-0.5 min-h-7 px-0.5 text-left text-[10.5px] leading-7 text-sub transition hover:text-ink">
                                  {message.user.name || message.user.username}
                                </button>
                              )}
                              {(message.cooked?.trim() || message.message?.trim()) && (
                                <div
                                  id={`chat-bubble-${message.id}`} data-message-actions tabIndex={0} role="button"
                                  aria-label="消息内容，点击打开操作菜单" aria-haspopup="true" aria-expanded={messageMenu?.id === message.id}
                                  onClick={(event) => {
                                    if (event.target instanceof Element && event.target.closest('a, button, input')) return
                                    if (window.getSelection()?.toString()) return
                                    openMessageMenu(message, event.clientX, event.clientY)
                                  }}
                                  onContextMenu={(event) => { event.preventDefault(); openMessageMenu(message, event.clientX, event.clientY) }}
                                  onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget || !['Enter', ' ', 'ContextMenu'].includes(event.key)) return
                                    event.preventDefault()
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    openMessageMenu(message, rect.left, rect.bottom)
                                  }}
                                  className={`post-body cursor-pointer rounded-2xl px-3 py-2 text-[13px] leading-relaxed text-ink ${
                                    mine ? 'bg-bubble-mine' : 'bg-bubble-other'
                                  }`}
                                  dangerouslySetInnerHTML={{ __html: html }}
                                />
                              )}
                              {message.in_reply_to && <p className="mb-1 text-[11px] text-sub">回复 @{message.in_reply_to.user?.username || '用户'}：{message.in_reply_to.excerpt || `消息 #${message.in_reply_to.id}`}</p>}
                              {message.pinned && <span className="text-[11px] text-sub">📌 已置顶</span>}
                              {message.reactions?.length ? <div className="flex gap-2 text-xs text-sub">{message.reactions.map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.count}</span>)}</div> : null}
                              {message.uploads?.filter((upload) => !(message.cooked || '').includes(upload.url)).map((upload) => (
                                <a
                                  key={upload.id}
                                  href={absolutize(upload.url)}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="mt-1 block"
                                >
                                  <img
                                    src={absolutize(upload.url)}
                                    alt={upload.original_filename || '附件'}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                    className="max-h-[240px] max-w-[220px] rounded-xl object-cover"
                                  />
                                </a>
                              ))}
                              {(selectedMessages.size > 0 || message.edited) && <div className="mt-1 flex items-center gap-2">
                                {selectedMessages.size > 0 && <input type="checkbox" aria-label="选择消息" checked={selectedMessages.has(message.id)} onChange={() => setSelectedMessages((prev) => { const next = new Set(prev); next.has(message.id) ? next.delete(message.id) : next.add(message.id); return next })} />}
                                {message.edited && <span className="text-[10px] text-sub">已编辑</span>}
                              </div>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>

              <div className="shrink-0 border-t border-line px-3 py-3 md:px-4">
                {actionNotice && <p role="status" className="mb-2 text-xs text-sub">{actionNotice}</p>}
                {selectedMessages.size > 0 && <div className="mb-2 flex gap-3 text-xs text-sub"><span>已选择 {selectedMessages.size} 条消息</span><button onClick={async () => { try { await navigator.clipboard.writeText(messages.filter((item) => selectedMessages.has(item.id)).map((item) => `${item.user.username}: ${item.message}`).join('\n')); setActionNotice('所选消息已复制') } catch { setActionNotice('复制失败，请检查剪贴板权限') } }}>复制所选内容</button><button onClick={() => setSelectedMessages(new Set())}>退出选择</button></div>}
                {editing && <div className="mb-2 flex justify-between text-xs text-sub"><span>编辑消息</span><button onClick={() => { setEditing(null); setRaw(''); setAttachments([]) }}>取消编辑</button></div>}
                {attachments.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto">{attachments.map((item) => <div key={item.id} className="relative shrink-0"><img src={absolutize(item.url)} alt={item.original_filename || '待发送图片'} className="h-20 w-20 rounded-lg object-cover" /><button aria-label="移除图片" onClick={() => setAttachments((prev) => prev.filter((upload) => upload.id !== item.id))} className="absolute right-0 top-0 rounded-full bg-black/60 px-1 text-white">×</button></div>)}</div>}
                {uploading && <p role="status" className="mb-2 text-xs text-sub">图片上传中…</p>}
                {hasMoreFuture && <button onClick={() => setMsgReloadKey((value) => value + 1)} className="mb-2 text-xs text-sub">跳到最新消息</button>}
                {sendError && (
                  <p className="mb-1.5 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[11.5px] leading-relaxed text-danger">
                    {sendError}
                  </p>
                )}
                <EmojiPicker
                  open={emojiOpen}
                  onClose={() => setEmojiOpen(false)}
                  onInsert={(text) => setRaw((prev) => prev + text)}
                />
                <div className="mt-1.5 flex items-end gap-2">
                  <textarea
                    ref={composerRef}
                    value={raw}
                    onChange={(event) => setRaw(event.target.value)}
                    onKeyDown={onComposerKeyDown}
                    onPaste={(event) => {
                      const files = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => Boolean(file && file.type.startsWith('image/')))
                      if (files.length) { event.preventDefault(); void uploadChatImages(files) }
                    }}
                    placeholder="发消息…"
                    rows={2}
                    className="min-h-[58px] flex-1 resize-none rounded-xl bg-soft/60 px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition focus:bg-soft"
                  />
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { void uploadChatImages(Array.from(event.target.files || [])); event.target.value = '' }} />
                  <button disabled={uploading || sending} onClick={() => fileRef.current?.click()} aria-label="上传图片" className="h-9 w-9 rounded-full text-sub hover:bg-soft">＋</button>
                  <button
                    onClick={() => setEmojiOpen((value) => !value)}
                    aria-label="表情"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sub transition hover:bg-soft hover:text-ink"
                  >
                    <EmojiIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void send()}
                    disabled={sending || uploading || (!raw.trim() && !attachments.length)}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent-fill px-4 text-[12.5px] font-medium text-white transition disabled:opacity-50"
                  >
                    <SendIcon className="h-3.5 w-3.5" />
                    {sending ? '发送中…' : editing ? '保存修改' : '发送'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <ChatIcon className="mx-auto h-9 w-9 text-sub/50" />
                <p className="mt-3 text-[13px] text-ink">选择一个会话</p>
                <p className="mt-1 text-[11.5px] text-sub">
                  左侧是私信与公开频道，点开后在这里对话。
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
      {messageMenu && (() => {
        const message = messages.find((item) => item.id === messageMenu.id)
        if (!message) return null
        const mine = message.user.username === selfUsername
        return (
                                <div ref={messageMenuRef} role="group" aria-label="消息操作" style={{ left: messageMenu!.x, top: messageMenu!.y }} className="fixed z-[60] flex w-[200px] flex-col rounded-xl border border-line bg-surface p-1.5 text-[13px] text-sub shadow-xl">
                                  <button disabled={actionBusy} onClick={() => void runMessageAction(message, 'copy')} className="rounded-lg px-3 py-2 text-left hover:bg-soft focus:bg-soft disabled:opacity-40">复制链接</button>
                                  <button onClick={() => { setSelectedMessages((prev) => new Set([...prev, message.id])); setMessageMenu(null) }} className="rounded-lg px-3 py-2 text-left hover:bg-soft focus:bg-soft disabled:opacity-40">选择</button>
                                  {(mine || canModerate) && <button onClick={() => { setEditing(message); setRaw(message.message); setAttachments(message.uploads || []); setMessageMenu(null); composerRef.current?.focus() }} className="rounded-lg px-3 py-2 text-left hover:bg-soft focus:bg-soft disabled:opacity-40">编辑</button>}
                                  {canModerate && <button disabled={actionBusy} onClick={() => void runMessageAction(message, 'pin')} className="rounded-lg px-3 py-2 text-left hover:bg-soft focus:bg-soft disabled:opacity-40">{message.pinned ? '取消置顶' : '置顶消息'}</button>}
                                  {(mine || canModerate) && <button disabled={actionBusy} onClick={() => void runMessageAction(message, 'delete')} className="rounded-lg px-3 py-2 text-left hover:bg-soft focus:bg-soft disabled:opacity-40">删除</button>}
                                  {canModerate && <button disabled={actionBusy} onClick={() => void runMessageAction(message, 'rebake')} className="rounded-lg px-3 py-2 text-left hover:bg-soft focus:bg-soft disabled:opacity-40">重建 HTML</button>}
                                </div>
        )
      })()}
      {userMenu && (
        <div ref={userMenuRef} role="group" aria-label={`@${userMenu.username} 的操作`}
          style={{ left: userMenu.x, top: userMenu.y }}
          className="fixed z-50 w-48 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <button type="button" onClick={() => mentionUser(userMenu.username)}
            className="block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-soft focus:bg-soft">
            @{userMenu.username}
          </button>
          <button type="button" onClick={() => { openUserCard(userMenu.username); setUserMenu(null) }} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-soft">用户资料 · 私信 / 聊天</button>
          <a href={`#/u/${encodeURIComponent(userMenu.username)}`} onClick={() => setUserMenu(null)}
            className="block rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-soft focus:bg-soft">
            查看主页
          </a>
        </div>
      )}
    </div>
  )
}
