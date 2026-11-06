import UpdateNotice from './components/UpdateNotice'
import DesktopTitleBar from './components/DesktopTitleBar'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Sidebar, { MobileNav, type SidebarActive } from './components/Sidebar'
import AuthModal from './components/AuthModal'
import TopicModal from './components/TopicModal'
import UserCard from './components/UserCard'
import EmptyState from './components/EmptyState'
import { UserIcon } from './components/icons'
import { NewTopicModal } from './components/Composer'
import FeedPage from './pages/FeedPage'
import SearchPage from './pages/SearchPage'
import CategoriesPage from './pages/CategoriesPage'
import NotificationsPage from './pages/NotificationsPage'
import MessagesPage from './pages/MessagesPage'
import ProfilePage from './pages/ProfilePage'
import {
  AUTH_EVENT,
  clearSession,
  completeLogin,
  loadSession,
  readPayloadFromLocation,
  type AuthSession,
} from './lib/auth'
import { errorMessage, fetchNotifications } from './api'

type Route =
  | { name: 'feed' }
  | { name: 'category'; id: number }
  | { name: 'categories' }
  | { name: 'topic'; id: number; post?: number; reply?: boolean }
  | { name: 'search'; q: string }
  | { name: 'notifications' }
  | { name: 'messages'; channelId?: number; dm?: string }
  | { name: 'profile'; username: string }
  | { name: 'me' }
  | { name: 'authCallback' }

const DARK_KEY = 'trae-lite.dark.v1'
const READ_KEY = 'trae-lite.notif-read.v1'

function hashQuery(hash: string) {
  return new URLSearchParams(hash.split('?')[1] || '')
}

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, '')
  const topic = hash.match(/^\/topic\/(\d+)/)
  if (topic) {
    const params = hashQuery(hash)
    return {
      name: 'topic',
      id: Number(topic[1]),
      post: params.get('post') ? Number(params.get('post')) : undefined,
      reply: params.get('reply') === '1',
    }
  }
  if (hash.startsWith('/auth/callback') || hash.startsWith('/auth/result')) {
    return { name: 'authCallback' }
  }
  if (hash.startsWith('/search')) {
    const params = new URLSearchParams(hash.split('?')[1] || '')
    return { name: 'search', q: params.get('q') || '' }
  }
  const category = hash.match(/^\/c\/(\d+)/)
  if (category) return { name: 'category', id: Number(category[1]) }
  if (hash.startsWith('/categories')) return { name: 'categories' }
  if (hash.startsWith('/notifications')) return { name: 'notifications' }
  if (hash.startsWith('/messages')) {
    const id = hash.match(/^\/messages\/(\d+)/)
    const params = hashQuery(hash)
    return {
      name: 'messages',
      channelId: id ? Number(id[1]) : undefined,
      dm: params.get('dm') || undefined,
    }
  }
  if (hash.startsWith('/me')) return { name: 'me' }
  const profile = hash.match(/^\/u\/([^/?#]+)/)
  if (profile) return { name: 'profile', username: decodeURIComponent(profile[1]) }
  return { name: 'feed' }
}

function hashOf(route: Route): string {
  switch (route.name) {
    case 'category':
      return `#/c/${route.id}`
    case 'categories':
      return '#/categories'
    case 'search':
      return `#/search${route.q ? `?q=${encodeURIComponent(route.q)}` : ''}`
    case 'notifications':
      return '#/notifications'
    case 'messages':
      if (route.channelId) return `#/messages/${route.channelId}`
      return route.dm ? `#/messages?dm=${encodeURIComponent(route.dm)}` : '#/messages'
    case 'profile':
      return `#/u/${encodeURIComponent(route.username)}`
    case 'me':
      return '#/me'
    default:
      return '#/'
  }
}

function loadDark() {
  try {
    return localStorage.getItem(DARK_KEY) === '1'
  } catch {
    return false
  }
}

function readLocalReadIds(): Set<number> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    const list = raw ? (JSON.parse(raw) as number[]) : []
    return new Set(Array.isArray(list) ? list : [])
  } catch {
    return new Set()
  }
}

export default function App() {
  const pageRef = useRef<HTMLElement>(null)
  const initial = useRef<Route>(parseHash())
  const [route, setRoute] = useState<Route>(initial.current)
  const [base, setBase] = useState<Route>(
    initial.current.name === 'topic' ? { name: 'feed' } : initial.current,
  )
  const [feedCount, setFeedCount] = useState(0)
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())
  const [authOpen, setAuthOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [dark, setDark] = useState(loadDark)
  const [callback, setCallback] = useState<{ status: 'waiting' | 'ok' | 'error'; message?: string }>({
    status: 'waiting',
  })

  const routeRef = useRef(route)
  const baseRef = useRef(base)
  const backgroundScrollRef = useRef({ x: window.scrollX, y: window.scrollY })
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    const onChange = () => {
      const next = parseHash()
      const previous = routeRef.current
      if (next.name === 'topic') {
        if (previous.name !== 'topic') {
          backgroundScrollRef.current = { x: window.scrollX, y: window.scrollY }
        }
        // 详情切换时保留背景列表，不滚动、不重新挂载列表。
        pendingScrollRef.current = null
      } else {
        const returningToBackground = previous.name === 'topic' && hashOf(next) === hashOf(baseRef.current)
        pendingScrollRef.current = returningToBackground ? backgroundScrollRef.current : { x: 0, y: 0 }
        baseRef.current = next
        setBase(next)
      }
      routeRef.current = next
      setRoute(next)
    }
    window.addEventListener('hashchange', onChange)
    return () => {
      window.removeEventListener('hashchange', onChange)
      window.history.scrollRestoration = previousRestoration
    }
  }, [])

  useLayoutEffect(() => {
    const position = pendingScrollRef.current
    pendingScrollRef.current = null
    if (!position) return
    const restore = () => window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' })
    restore()
    // 等待详情弹层解除背景滚动锁后再校准一次。
    const frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [route])

  // 登录/退出发生在任意入口时，侧栏与移动底栏立即切换，无需刷新
  useEffect(() => {
    const onAuthChanged = () => {
      const next = loadSession()
      setSession(next)
      if (!next) setUnread(0)
    }
    window.addEventListener(AUTH_EVENT, onAuthChanged)
    return () => window.removeEventListener(AUTH_EVENT, onAuthChanged)
  }, [])

  // 站点若开放回调白名单，授权结果会带着 payload 回到这里，自动解密并登录
  useEffect(() => {
    const payload = readPayloadFromLocation()
    if (!payload) {
      if (parseHash().name === 'authCallback') {
        setCallback({
          status: 'error',
          message:
            '链接里没有 payload。当前站点未开放回调白名单，请用右上角头像进入登录面板，手动粘贴授权页给出的 payload。',
        })
      }
      return
    }
    setRoute({ name: 'authCallback' })
    completeLogin(payload)
      .then((next) => {
        setSession(next)
        setCallback({ status: 'ok' })
        window.history.replaceState(null, '', `${window.location.pathname}#/`)
      })
      .catch((err) => {
        setCallback({ status: 'error', message: errorMessage(err) })
      })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem(DARK_KEY, dark ? '1' : '0')
    } catch {
      // ignore
    }
  }, [dark])

  // 登录后读取未读通知数，用于侧栏徽标
  useEffect(() => {
    if (!session) {
      setUnread(0)
      return
    }
    const controller = new AbortController()
    fetchNotifications(session.key, 40, 0, controller.signal)
      .then((data) => {
        const local = readLocalReadIds()
        const count = (data.notifications || []).filter(
          (item) => !item.read && !local.has(item.id),
        ).length
        setUnread(count)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [session?.key])

  useEffect(() => {
    const titleMap: Partial<Record<Route['name'], string>> = {
      feed: 'TRAE社区',
      categories: '所有分类 · TRAE 社区',
      notifications: '通知 · TRAE 社区',
      messages: '消息 · TRAE 社区',
      profile: '个人主页 · TRAE 社区',
      me: '我的主页 · TRAE 社区',
      authCallback: '授权结果 · TRAE 社区',
    }
    let title = titleMap[route.name] || 'TRAE社区'
    if (route.name === 'search') title = route.q ? `搜索 ${route.q} · TRAE 社区` : '搜索 · TRAE 社区'
    document.title = title
  }, [route])

  const requireLogin = () => {
    if (!session) setAuthOpen(true)
  }

  const handleCompose = () => {
    setComposeOpen(true)
  }

  const openTopic = (id: number, postNumber?: number, replyMode?: boolean) => {
    const params = new URLSearchParams()
    if (postNumber) params.set('post', String(postNumber))
    if (replyMode) params.set('reply', '1')
    const suffix = params.toString() ? `?${params.toString()}` : ''
    window.location.hash = `/topic/${id}${suffix}`
  }

  const closeTopic = () => {
    window.location.hash = hashOf(base)
  }

  const view = route.name === 'topic' ? base : route
  const pageKey = hashOf(view)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = pageRef.current?.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' })
    return () => animation?.cancel()
  }, [pageKey])

  const active: SidebarActive =
    view.name === 'feed' || view.name === 'category'
      ? 'feed'
      : view.name === 'categories'
        ? 'categories'
        : view.name === 'notifications'
          ? 'notifications'
          : view.name === 'messages'
            ? 'messages'
            : view.name === 'profile' || view.name === 'me'
              ? 'profile'
              : null

  const logout = () => {
    clearSession()
    setSession(null)
    setUnread(0)
  }

  return (
    <div className="min-h-screen">
      <DesktopTitleBar />
      <UpdateNotice />
      <div className="app-shell">
        <Sidebar
          session={session}
          active={active}
          unread={unread}
          dark={dark}
          onToggleDark={() => setDark((prev) => !prev)}
          onAccount={() => setAuthOpen(true)}
          onCompose={handleCompose}
          onLogout={logout}
        />

        <main ref={pageRef} className="app-main min-w-0 flex-1">
          {view.name === 'feed' && <FeedPage onCount={setFeedCount} />}
          {view.name === 'category' && (
            <FeedPage onCount={setFeedCount} categoryId={view.id} />
          )}
          {view.name === 'categories' && (
            <CategoriesPage onOpenCategory={(id) => (window.location.hash = `/c/${id}`)} />
          )}
          {view.name === 'search' && <SearchPage query={view.q} />}
          {view.name === 'notifications' && (
            <NotificationsPage
              session={session}
              onRequireLogin={requireLogin}
              onOpenTopic={openTopic}
              onUnread={setUnread}
            />
          )}
          {view.name === 'messages' && (
            <MessagesPage
              session={session}
              onRequireLogin={requireLogin}
              initialChannelId={view.channelId}
              initialDmUsername={view.dm}
              onSelectChannel={(id) => {
                window.location.hash = id ? `/messages/${id}` : '/messages'
              }}
            />
          )}
          {view.name === 'profile' && (
            <ProfilePage
              username={view.username}
              session={session}
              onRequireLogin={requireLogin}
              onOpenTopic={openTopic}
            />
          )}
          {view.name === 'me' &&
            (session ? (
              <ProfilePage
                username={session.username}
                session={session}
                onRequireLogin={requireLogin}
                onOpenTopic={openTopic}
              />
            ) : (
              <EmptyState
                icon={<UserIcon className="h-7 w-7" />}
                title="登录后查看我的主页"
                description="该站点对匿名访问隐藏了用户资料与动态；未登录不会发起任何请求。"
                onLogin={requireLogin}
              />
            ))}
          {view.name === 'authCallback' && (
            <AuthCallbackView state={callback} onLogin={() => setAuthOpen(true)} />
          )}
        </main>
      </div>

      {/* 消息页是一体式满屏布局，页脚会在其下方多出一条可滚动空白，故不渲染 */}
      {route.name !== 'messages' && (
        <footer className="border-t border-line bg-surface/60 py-6 pb-20 text-center text-[11.5px] leading-relaxed text-sub md:pb-6">
        <p>
          第三方客户端 · 数据来自{' '}
          <a
            href="https://forum.trae.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink/70 hover:text-accent"
          >
            forum.trae.cn
          </a>
          {(route.name === 'feed' || route.name === 'category') && (
            <> · 当前已加载 {feedCount} 条信息流</>
          )}
        </p>
        <p className="mt-1">
          写操作（点赞 / 回复 / 发帖）需登录；API Key 仅存本机 localStorage，可随时在论坛「设置 → 应用」撤销。
        </p>
      </footer>
      )}

      {route.name === 'topic' && (
        <TopicModal
          id={route.id}
          session={session}
          focusPostNumber={route.post}
          initialReply={route.reply}
          onClose={closeTopic}
          onRequireLogin={requireLogin}
        />
      )}

      <UserCard session={session} onRequireLogin={requireLogin} />
      <AuthModal
        open={authOpen}
        session={session}
        onClose={() => setAuthOpen(false)}
        onSession={(next) => setSession(next)}
        onLogout={logout}
      />

      {composeOpen && (
        <NewTopicModal
          key={session?.username || 'anonymous'}
          session={session}
          onRequireLogin={() => setAuthOpen(true)}
          onClose={() => setComposeOpen(false)}
          onSuccess={(created) => {
            const id = created.topic_id || created.id
            setComposeOpen(false)
            if (id) window.location.hash = `/topic/${id}`
          }}
        />
      )}

      <MobileNav
        session={session}
        active={active}
        unread={unread}
        onAccount={() => setAuthOpen(true)}
        onCompose={handleCompose}
      />
    </div>
  )
}

function AuthCallbackView({
  state,
  onLogin,
}: {
  state: { status: 'waiting' | 'ok' | 'error'; message?: string }
  onLogin: () => void
}) {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      {state.status === 'waiting' && <p className="text-sm text-ink">正在校验授权结果…</p>}
      {state.status === 'ok' && (
        <>
          <p className="text-sm text-ink">授权成功，已保存到本机。</p>
          <a
            href="#/"
            className="mt-5 inline-block rounded-full bg-btn px-5 py-2 text-[13px] font-medium text-white"
          >
            回到信息流
          </a>
        </>
      )}
      {state.status === 'error' && (
        <>
          <pre className="whitespace-pre-wrap text-left text-[12.5px] leading-relaxed text-ink">{state.message}</pre>
          <div className="mt-5 flex justify-center gap-2">
            <button
              onClick={onLogin}
              className="rounded-full bg-btn px-5 py-2 text-[13px] font-medium text-white hover:opacity-90"
            >
              打开登录面板
            </button>
            <a href="#/" className="rounded-full border border-line bg-surface px-5 py-2 text-[13px] text-ink">
              回到信息流
            </a>
          </div>
        </>
      )}
    </div>
  )
}
