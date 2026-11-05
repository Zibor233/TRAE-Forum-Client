/** 论坛接口返回的状态码（ApiError 与本地代理错误都带 status） */
export function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/** 429 时建议等待的秒数（来自 Retry-After 或响应体 retryAfter），默认 5 秒 */
export function errorRetryAfter(error: unknown): number {
  const value = (error as { retryAfter?: unknown } | null)?.retryAfter
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.min(60, Math.max(1, Math.round(value)))
  }
  return 5
}

/** 通知 / 私信 / 收藏等「登录后才能看」的接口：只给中性结论，不暴露状态码 */
export function privateErrorMessage(status: number | null): string {
  if (status === 401 || status === 403) return '仅自己可见，或该内容已删除'
  if (status === 404) return '该内容已删除或不存在'
  return '暂无内容'
}

/** 用户主页：用户不存在或被站点隐藏 */
export function profileErrorMessage(status: number | null): string {
  if (status === 401 || status === 403 || status === 404) return '该用户不存在或资料不可见'
  return '暂无内容'
}
