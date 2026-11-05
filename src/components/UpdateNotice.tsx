import { useEffect, useState } from 'react'

interface Update { available: boolean; version?: string; url?: string }
export default function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let checking = false
    const check = async () => {
      if (checking || document.hidden || navigator.onLine === false) return
      checking = true
      try {
        const response = await fetch('/api/client/update', { signal: controller.signal })
        if (!response.ok) return
        const result: Update = await response.json()
        if (!controller.signal.aborted && result.available && result.version && result.url?.startsWith('https://github.com/Zibor233/TRAE-Forum-Client/releases/tag/')) {
          let dismissed = false
          try { dismissed = localStorage.getItem('trae-client.update-dismissed') === result.version } catch { /* Storage is optional. */ }
          if (!dismissed) setUpdate(result)
        }
      } catch { /* Update checks must not interfere with forum access. */ }
      finally { checking = false }
    }
    const initial = window.setTimeout(() => void check(), 15_000)
    const interval = window.setInterval(() => void check(), 6 * 60 * 60_000)
    return () => { controller.abort(); clearTimeout(initial); clearInterval(interval) }
  }, [])
  if (!update) return null
  return <div role="status" className="fixed bottom-20 right-4 z-[100] max-w-sm rounded-xl border border-line bg-surface p-4 text-sm text-ink shadow-lg md:bottom-5">
    <p>有新版本 {update.version} 可以更新了</p>
    <div className="mt-3 flex justify-end gap-4"><button onClick={() => {
      try { localStorage.setItem('trae-client.update-dismissed', update.version!) } catch { /* Optional. */ }
      setUpdate(null)
    }} className="text-sub">稍后再说</button><a href={update.url} target="_blank" rel="noopener noreferrer" className="text-accent">查看更新</a></div>
  </div>
}
