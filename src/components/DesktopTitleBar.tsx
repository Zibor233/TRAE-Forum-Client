import TraeLogo from './Logo'

export default function DesktopTitleBar() {
  if (window.location.protocol !== 'trae:') return null
  return <header className="desktop-titlebar" aria-label="窗口标题栏">
    <div className="desktop-titlebar-content">
      <TraeLogo className="h-3.5 w-5 text-accent" />
      <span>TRAE社区</span>
      <span className="rounded border border-line px-1.5 py-0.5 text-[9px] leading-none text-sub">BETA</span>
    </div>
  </header>
}
