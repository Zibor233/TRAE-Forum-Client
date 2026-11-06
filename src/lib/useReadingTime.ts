import { useEffect, type RefObject } from 'react'
import { ApiError, reportReadingTime } from '../api'
import type { AuthSession } from './auth'
import { ReadingTime } from './readingTime'

/** Reports only foreground, recently active reading of a visible post. */
export function useReadingTime(rootRef: RefObject<HTMLDivElement>, topicId: number, session: AuthSession | null, ready: boolean) {
  const key = session?.key
  const username = session?.username
  useEffect(() => {
    const root = rootRef.current
    if (!ready || !root || !key || !username) return
    const clock = new ReadingTime(performance.now())
    let activity = performance.now()
    let lastFlush = activity
    let blocked = false
    let cooldownUntil = 0
    let busy = false
    let flushAgain = false

    const visiblePost = () => {
      const bounds = root.getBoundingClientRect()
      const footer = root.parentElement?.querySelector('[data-reading-footer]')?.getBoundingClientRect()
      const top = Math.max(0, bounds.top)
      const bottom = Math.min(window.innerHeight, bounds.bottom, footer?.top ?? Infinity)
      const left = Math.max(0, bounds.left)
      const right = Math.min(window.innerWidth, bounds.right)
      if (bottom <= top || right <= left) return null
      let best: number | null = null
      let bestHeight = 0
      for (const node of root.querySelectorAll<HTMLElement>('[data-reading-post]')) {
        const rect = node.getBoundingClientRect()
        const start = Math.max(top, rect.top)
        const end = Math.min(bottom, rect.bottom)
        const height = end - start
        if (height < 16 || height <= bestHeight) continue
        const hit = document.elementFromPoint((left + right) / 2, (start + end) / 2)
        // A user card, dialog or other overlay covering the content pauses reading.
        if (!hit || !node.contains(hit)) continue
        best = Number(node.dataset.readingPost)
        bestHeight = height
      }
      return best
    }
    const tick = () => {
      const now = performance.now()
      const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]')
      const eligible = !blocked && now >= cooldownUntil && document.visibilityState === 'visible' && document.hasFocus() && now - activity < 60_000 && !editing
      clock.tick(now, eligible ? visiblePost() : null, eligible)
    }
    const flush = () => {
      if (blocked || performance.now() < cooldownUntil) return
      if (busy) { flushAgain = true; return }
      const batch = clock.drain()
      if (!batch) return
      busy = true
      // Additive writes are never retried: a lost response may still mean success.
      void reportReadingTime(topicId, batch, key, username).catch((error: unknown) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) blocked = true
        cooldownUntil = performance.now() + Math.max(60_000, error instanceof ApiError ? (error.retryAfter || 0) * 1000 : 0)
      }).finally(() => {
        busy = false
        if (flushAgain) { flushAgain = false; flush() }
      })
    }
    const active = () => {
      const now = performance.now()
      if (now - activity >= 60_000) clock.reset(now)
      activity = now
    }
    const suspend = () => { clock.reset(performance.now()); flush() }
    const resume = () => { activity = performance.now(); clock.reset(activity) }
    const visibility = () => {
      if (document.visibilityState !== 'visible') suspend()
      else resume()
    }
    const timer = window.setInterval(() => {
      tick()
      if (performance.now() - lastFlush >= 30_000) { lastFlush = performance.now(); flush() }
    }, 1000)
    const events = ['scroll', 'pointermove', 'pointerdown', 'keydown', 'touchstart'] as const
    for (const event of events) root.addEventListener(event, active, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', suspend)
    window.addEventListener('focus', resume)
    window.addEventListener('pagehide', suspend)
    return () => {
      tick()
      window.clearInterval(timer)
      for (const event of events) root.removeEventListener(event, active)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', suspend)
      window.removeEventListener('focus', resume)
      window.removeEventListener('pagehide', suspend)
      flush()
    }
  }, [rootRef, topicId, key, username, ready])
}
