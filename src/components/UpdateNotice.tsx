import { useEffect, useState } from 'react'

interface Update { available: boolean; version?: string; url?: string; currentVersion?: string; error?: string }
export default function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let checking = false
    const check = async (manual = false) => {
      if (checking || (!manual && (document.hidden || navigator.onLine === false))) return
      if (manual) { setUpdate(null); setMessage('正在检测更新…') }
      checking = true
      try {
        const response = await fetch(manual ? '/api/client/update?force=1' : '/api/client/update', { signal: controller.signal })
        if (!response.ok) throw new Error('检测更新失败，请稍后重试')
        const result: Update = await response.json()
        if (!controller.signal.aborted && result.available && result.version && result.url?.startsWith('https://github.com/Zibor233/TRAE-Forum-Client/releases/tag/')) {
          let dismissed = false
          try { dismissed = localStorage.getItem('trae-client.update-dismissed') === result.version } catch { /* Storage is optional. */ }
          if (manual || !dismissed) { setUpdate(result); setMessage('') }
        }
        if (manual && !result.available) setMessage(result.error || `当前已是最新版本 ${result.currentVersion || ''}`)
        if (manual && result.error) setMessage(result.error)
      } catch { if (manual && !controller.signal.aborted) setMessage('检测更新失败，请稍后重试') }
      finally { checking = false }
    }
    const manualCheck = () => { void check(true) }
    window.addEventListener('trae:check-updates', manualCheck)
    const initial = window.setTimeout(() => void check(), 15_000)
    const interval = window.setInterval(() => void check(), 6 * 60 * 60_000)
    return () => { window.removeEventListener('trae:check-updates', manualCheck); controller.abort(); clearTimeout(initial); clearInterval(interval) }
  }, [])
  if (!update && !message) return null
  if (!update) return <div role="status" className="fixed bottom-20 right-4 z-[100] max-w-sm rounded-xl border border-line bg-surface p-4 text-sm text-ink shadow-lg md:bottom-5">{message}<button onClick={() => setMessage('')} aria-label="关闭更新提示" className="ml-4 text-sub">×</button></div>
  return <div role="status" className="fixed bottom-20 right-4 z-[100] max-w-sm rounded-xl border border-line bg-surface p-4 text-sm text-ink shadow-lg md:bottom-5">
    <p>有新版本 {update.version} 可以更新了</p>
    <div className="mt-3 flex justify-end gap-4"><button onClick={() => {
      try { localStorage.setItem('trae-client.update-dismissed', update.version!) } catch { /* Optional. */ }
      setUpdate(null)
    }} className="text-sub">稍后再说</button><a href={update.url} target="_blank" rel="noopener noreferrer" className="text-accent">查看更新</a></div>
  </div>
}
