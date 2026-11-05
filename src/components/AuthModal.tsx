import { useEffect, useState } from 'react'
import {
  APPLICATION_NAME,
  AUTH_SCOPES,
  buildAuthUrl,
  completeLogin,
  createPendingAuth,
  loadPending,
  maskKey,
  revokeUrl,
  type AuthSession,
  type PendingAuth,
} from '../lib/auth'

interface AuthModalProps {
  open: boolean
  session: AuthSession | null
  onClose: () => void
  onSession: (session: AuthSession) => void
  onLogout: () => void
}

export default function AuthModal({ open, session, onClose, onSession, onLogout }: AuthModalProps) {
  const [pending, setPending] = useState<PendingAuth | null>(null)
  const [generating, setGenerating] = useState(false)
  const [authUrl, setAuthUrl] = useState('')
  const [opened, setOpened] = useState(false)
  const [payload, setPayload] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || session) return
    setError('')
    setSuccess(false)
    const existing = loadPending()
    if (existing) {
      setPending(existing)
      return
    }
    let cancelled = false
    setGenerating(true)
    const timer = setTimeout(() => {
      try {
        const created = createPendingAuth()
        if (!cancelled) {
          setPending(created)
          setGenerating(false)
        }
      } catch (err) {
        if (!cancelled) {
          setGenerating(false)
          setError(err instanceof Error ? err.message : '密钥生成失败')
        }
      }
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, session])

  useEffect(() => {
    if (!open) {
      setOpened(false)
      setPayload('')
      setError('')
      setSuccess(false)
    }
  }, [open])

  if (!open) return null

  const startAuth = () => {
    setError('')
    let current = pending
    if (!current) {
      try {
        current = createPendingAuth()
        setPending(current)
      } catch (err) {
        setError(err instanceof Error ? err.message : '密钥生成失败')
        return
      }
    }
    const url = buildAuthUrl(current)
    setAuthUrl(url)
    const win = window.open(url, 'trae-forum-auth', 'width=560,height=760')
    if (win) {
      win.opener = null
      setOpened(true)
    } else {
      setOpened(true)
      setError('浏览器拦截了新窗口，请点击下方链接手动打开授权页。')
    }
  }

  const finishLogin = async () => {
    if (!payload.trim()) {
      setError('请先粘贴授权页给出的 payload')
      return
    }
    setBusy(true)
    setError('')
    try {
      const next = await completeLogin(payload.trim())
      onSession(next)
      setSuccess(true)
      setPayload('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const regenerate = () => {
    try {
      const current = createPendingAuth()
      setPending(current)
      setAuthUrl('')
      setOpened(false)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '密钥生成失败')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-[540px] overflow-y-auto rounded-t-2xl border border-line bg-surface p-6 sm:rounded-2xl">
        {session ? (
          <SessionView session={session} onClose={onClose} onLogout={onLogout} />
        ) : success ? (
          <div className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ok-soft text-2xl">✓</div>
            <h2 className="mt-4 text-[18px] font-semibold text-ink">登录成功</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-sub">
              密钥已保存到本浏览器。现在可以点赞、回复和发帖了。
            </p>
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-full bg-btn py-2.5 text-[13.5px] font-medium text-white hover:opacity-90"
            >
              进入社区
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-semibold text-ink">登录 TRAE 社区</h2>
                <p className="mt-1 text-[12.5px] text-sub">
                  通过 Discourse User API Key 授权，仅用于点赞、回复和发帖。
                </p>
              </div>
              <button onClick={onClose} className="text-sub hover:text-ink" aria-label="关闭">
                ✕
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12px] leading-relaxed text-amber-800">
              <p className="font-medium">密钥安全说明</p>
              <p className="mt-1">
                API Key 仅保存在本机浏览器 localStorage，私钥在登录完成后立即丢弃；请求只经本机代理转发到
                forum.trae.cn。可随时在论坛「设置 → 应用」中撤销。
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-line bg-paper/60 px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-ink">第 1 步 · 生成密钥并打开论坛授权页</span>
                  {generating ? (
                    <span className="text-[11.5px] text-sub">正在生成 2048 位密钥…</span>
                  ) : pending ? (
                    <span className="text-[11.5px] text-emerald-600">密钥已就绪</span>
                  ) : null}
                </div>
                <button
                  onClick={startAuth}
                  disabled={generating}
                  className="mt-2.5 w-full rounded-full bg-accent-fill py-2.5 text-[13.5px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {opened ? '重新打开授权页' : '打开论坛授权页'}
                </button>
                {authUrl && opened && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-sub">
                    若新窗口未弹出，
                    <a href={authUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      点此打开授权页
                    </a>
                    （需先在官方页面登录，再点击「授权」）。
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-line bg-paper/60 px-3.5 py-3">
                <div className="text-[12.5px] font-medium text-ink">第 2 步 · 粘贴授权页给出的 payload</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-sub">
                  本社区未在论坛的回调白名单内，授权成功后官方页面会直接显示一段 Base64 密文（payload）。复制后粘贴到下方，
                  解密与保存都在本机完成。
                </p>
                <textarea
                  value={payload}
                  onChange={(event) => setPayload(event.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder="粘贴授权页显示的加密 payload"
                  className="mt-2 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-accent/40"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={finishLogin}
                    disabled={busy || !payload.trim()}
                    className="rounded-full bg-btn px-4 py-2 text-[12.5px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? '正在校验…' : '完成登录'}
                  </button>
                  <button onClick={regenerate} disabled={busy} className="text-[11.5px] text-sub hover:text-ink">
                    重新生成密钥
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11.5px] leading-relaxed text-danger">
                {error}
              </pre>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-sub">
              申请 scopes：{AUTH_SCOPES}；应用名：{APPLICATION_NAME}。授权页需可访问 forum.trae.cn，且账号需满足论坛的信任等级要求。
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function SessionView({
  session,
  onClose,
  onLogout,
}: {
  session: AuthSession
  onClose: () => void
  onLogout: () => void
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">账号与密钥</h2>
          <p className="mt-1 text-[12.5px] text-sub">当前已通过 User API Key 登录。</p>
        </div>
        <button onClick={onClose} className="text-sub hover:text-ink" aria-label="关闭">
          ✕
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-paper/60 px-4 py-3 text-[12.5px]">
        <div className="flex items-center justify-between">
          <span className="text-sub">用户</span>
          <span className="font-medium text-ink">@{session.username}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sub">API Key</span>
          <span className="font-mono text-ink">{maskKey(session.key)}</span>
        </div>
        {session.apiVersion !== undefined && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-sub">授权版本</span>
            <span className="text-ink">v{session.apiVersion}</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sub">密钥保存</span>
          <span className="text-ink">本机 localStorage</span>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12px] leading-relaxed text-amber-800">
        API Key 拥有读 / 写权限，请勿在共享电脑上使用。发现异常时，立即到论坛「设置 → 应用」撤销。
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href={revokeUrl(session.username)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-line bg-surface px-4 py-2 text-[12.5px] text-ink hover:border-ink/30"
        >
          前往论坛撤销密钥
        </a>
        <button
          onClick={() => {
            onLogout()
            onClose()
          }}
          className="rounded-full bg-btn px-4 py-2 text-[12.5px] font-medium text-white hover:opacity-90"
        >
          退出登录
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-sub">
        退出只会清除本机保存的 key，不会自动撤销论坛端的授权；如需彻底失效，请使用上方撤销入口。
      </p>
    </>
  )
}
