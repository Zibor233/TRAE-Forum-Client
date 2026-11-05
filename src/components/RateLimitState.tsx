import EmptyState from './EmptyState'

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3.2 1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface RateLimitStateProps {
  onRetry: () => void
  compact?: boolean
}

/**
 * 加载失败占位：只保留「暂无内容 + 刷新」这一层信息。
 * 不显示限流、状态码、倒计时等实现细节，也不自动重试（读请求已在请求层静默重试）。
 */
export default function RateLimitState({ onRetry, compact }: RateLimitStateProps) {
  return (
    <EmptyState
      icon={<ClockIcon className="h-6 w-6" />}
      title="暂无内容，点击刷新"
      onRetry={onRetry}
      retryLabel="刷新"
      compact={compact}
    />
  )
}
