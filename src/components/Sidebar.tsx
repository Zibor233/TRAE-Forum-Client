import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BellIcon,
  ChatIcon,
  CompassIcon,
  InfoIcon,
  MoonIcon,
  MoreIcon,
  PlusIcon,
  SunIcon,
  UserIcon,
} from './icons'
import Avatar from './Avatar'
import { AUTHOR_PROFILE_URL, GITHUB_RELEASES_URL } from '../lib/links'
import Brand from './Brand'
import type { AuthSession } from '../lib/auth'

export type SidebarActive = 'feed' | 'categories' | 'notifications' | 'messages' | 'profile' | null

interface SidebarProps {
  session: AuthSession | null
  active?: SidebarActive
  unread?: number
  dark: boolean
  onToggleDark: () => void
  onAccount: () => void
  onCompose: () => void
  onLogout: () => void
}

export default function Sidebar({
  session,
  active = null,
  unread = 0,
  dark,
  onToggleDark,
  onAccount,
  onCompose,
  onLogout,
}: SidebarProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moreOpen) return
    const onDown = (event: globalThis.MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [moreOpen])

  return (
    <aside className="app-sidebar hidden shrink-0 md:block">
      <nav className="desktop-sidebar sticky top-5 flex h-[calc(100dvh-40px)] flex-col gap-1 pb-2">
        <a href="#/" className="mb-7 flex items-center gap-2 px-0" aria-label="回到首页">
          <Brand />
        </a>
        <SideLink
          href="#/"
          label="发现"
          icon={<CompassIcon className="h-[23px] w-[23px]" />}
          active={active === 'feed'}
        />
        <SideButton label="发布" icon={<PlusIcon className="h-[23px] w-[23px]" />} onClick={onCompose} />
        <SideLink
          href="#/notifications"
          label="通知"
          icon={<BellIcon className="h-[23px] w-[23px]" />}
          active={active === 'notifications'}
          badge={unread}
        />
        <SideLink
          href="#/messages"
          label="消息"
          icon={<ChatIcon className="h-[23px] w-[23px]" />}
          active={active === 'messages'}
        />
        {session && (
          <a
            href="#/me"
            className={`flex items-center gap-3 rounded-full px-4 py-3 text-[17px] transition ${
              active === 'profile' ? 'bg-surface font-medium text-ink' : 'text-sub hover:bg-surface hover:text-ink'
            }`}
          >
            <Avatar template={session.avatarTemplate} name={session.name || session.username} size={23} />
            我
          </a>
        )}

        {!session && (
          <div className="mt-3">
            <button
              onClick={onAccount}
              className="w-full rounded-lg bg-accent-fill py-3 text-[16px] font-medium text-white transition hover:opacity-90"
            >
              登录
            </button>
          </div>
        )}

        <div className="mt-auto space-y-1 pt-8">
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen((prev) => !prev)}
              className={`flex w-full items-center gap-3 rounded-full px-4 py-3 text-[17px] transition ${
                moreOpen ? 'bg-surface text-ink' : 'text-sub hover:bg-surface hover:text-ink'
              }`}
            >
              <MoreIcon className="h-[23px] w-[23px]" />
              更多
            </button>
            {moreOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-[196px] rounded-xl border border-line bg-surface-2 p-1.5">
                <button
                  onClick={onToggleDark}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-ink transition hover:bg-paper"
                >
                  {dark ? <MoonIcon className="h-4 w-4 text-sub" /> : <SunIcon className="h-4 w-4 text-sub" />}
                  <span className="flex-1">{dark ? '深色模式' : '浅色模式'}</span>
                  <span
                    className={`relative h-4 w-8 rounded-full transition ${dark ? 'bg-[#ff2442]' : 'bg-line'}`}
                    aria-hidden="true"
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                        dark ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </span>
                </button>
                <button type="button" onClick={() => { setMoreOpen(false); window.dispatchEvent(new Event('trae:check-updates')) }} className="block w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] text-ink transition hover:bg-paper">检测更新</button>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg px-2.5 py-2 text-[12.5px] text-ink transition hover:bg-paper"
                >
                  关于我们
                </a>
                {session && (
                  <button
                    onClick={() => {
                      setMoreOpen(false)
                      onLogout()
                    }}
                    className="mt-0.5 block w-full rounded-lg border-t border-line/70 px-2.5 py-2 text-left text-[12.5px] text-accent transition hover:bg-paper"
                  >
                    退出登录
                  </button>
                )}
              </div>
            )}
          </div>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-full px-4 py-3 text-[17px] text-sub transition hover:bg-surface hover:text-ink"
          >
            <InfoIcon className="h-[23px] w-[23px]" />
            关于我们
          </a>
          <p className="px-3 pt-2 text-[11.5px] text-sub/80">
            作者：<a href={AUTHOR_PROFILE_URL} target="_blank" rel="noopener noreferrer" className="transition hover:text-ink hover:underline">@小博同学</a>
          </p>
        </div>
      </nav>
    </aside>
  )
}

function SideLink({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string
  label: string
  icon: ReactNode
  active?: boolean
  badge?: number
}) {
  return (
    <a
      href={href}
      className={`flex items-center gap-3 rounded-full px-4 py-3 text-[17px] transition ${
        active ? 'bg-surface font-medium text-ink' : 'text-sub hover:bg-surface hover:text-ink'
      }`}
    >
      {icon}
      {label}
      {!!badge && (
        <span className="ml-auto min-w-[18px] rounded-full bg-[#ff2442] px-1 text-center text-[10.5px] leading-[18px] text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </a>
  )
}

function SideButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-full px-4 py-3 text-[17px] text-sub transition hover:bg-surface hover:text-ink"
    >
      {icon}
      {label}
    </button>
  )
}

export function MobileNav({
  session,
  active,
  unread = 0,
  onAccount,
  onCompose,
}: {
  session: AuthSession | null
  active?: SidebarActive
  unread?: number
  onAccount: () => void
  onCompose: () => void
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-line bg-surface/95 py-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <MobileLink href="#/" label="发现" active={active === 'feed'} icon={<CompassIcon className="h-5 w-5" />} />
      <button onClick={onCompose} className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10.5px] text-sub">
        <PlusIcon className="h-5 w-5" />
        发布
      </button>
      <MobileLink
        href="#/notifications"
        label="通知"
        active={active === 'notifications'}
        badge={unread}
        icon={<BellIcon className="h-5 w-5" />}
      />
      <MobileLink href="#/messages" label="消息" active={active === 'messages'} icon={<ChatIcon className="h-5 w-5" />} />
      {session ? (
        <a
          href="#/me"
          className={`flex flex-col items-center gap-0.5 px-3 py-1 text-[10.5px] ${
            active === 'profile' ? 'text-ink' : 'text-sub'
          }`}
        >
          <Avatar template={session.avatarTemplate} name={session.name || session.username} size={20} />
          我
        </a>
      ) : (
        <button
          onClick={onAccount}
          className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10.5px] text-sub"
        >
          <UserIcon className="h-5 w-5" />
          登录
        </button>
      )}
    </nav>
  )
}

function MobileLink({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string
  label: string
  icon: ReactNode
  active?: boolean
  badge?: number
}) {
  return (
    <a
      href={href}
      className={`relative flex flex-col items-center gap-0.5 px-3 py-1 text-[10.5px] ${
        active ? 'text-ink' : 'text-sub'
      }`}
    >
      {icon}
      {label}
      {!!badge && (
        <span className="absolute right-1.5 top-0 min-w-[14px] rounded-full bg-[#ff2442] px-0.5 text-center text-[9px] leading-[14px] text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </a>
  )
}
