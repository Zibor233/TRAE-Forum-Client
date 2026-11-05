import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  /** 未登录时的主按钮：登录 */
  onLogin?: () => void
  loginLabel?: string
  /** 错误态的重试（次要描边按钮） */
  onRetry?: () => void
  retryLabel?: string
  /** 论坛原始错误，折叠在「详情」里，不直接展示 */
  rawError?: string
  compact?: boolean
}

/** 登录引导 / 错误态 / 空状态统一版式：轻图标 + 主文案 + 灰色副文案 + 主按钮 */
export default function EmptyState({
  icon,
  title,
  description,
  onLogin,
  loginLabel = '登录',
  onRetry,
  retryLabel = '重新加载',
  rawError,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`mx-auto flex w-full max-w-[520px] flex-col items-center px-6 text-center ${
        compact ? 'py-10' : 'py-16'
      }`}
    >
      <div
        className={`grid place-items-center rounded-full bg-paper text-sub/60 ${
          compact ? 'h-14 w-14' : 'h-16 w-16'
        }`}
      >
        {icon}
      </div>
      <h2 className="mt-4 text-[15px] font-semibold leading-snug text-ink">{title}</h2>
      {description && (
        <p className="mt-2 max-w-[420px] text-[12.5px] leading-relaxed text-sub">{description}</p>
      )}

      {onLogin && (
        <button
          type="button"
          onClick={onLogin}
          className="mt-5 rounded-full bg-accent-fill px-6 py-2 text-[13px] font-medium text-white transition hover:opacity-90"
        >
          {loginLabel}
        </button>
      )}

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-full border border-line bg-surface px-5 py-1.5 text-[12.5px] text-sub transition hover:border-ink/25 hover:text-ink"
        >
          {retryLabel}
        </button>
      )}
      {rawError && (
        <details className="mt-4 w-full max-w-[440px] text-left">
          <summary className="cursor-pointer list-none text-[11.5px] text-sub/70 hover:text-sub">
            详情
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-paper px-3 py-2 text-[11px] leading-relaxed text-sub">
            {rawError}
          </pre>
        </details>
      )}
    </div>
  )
}
