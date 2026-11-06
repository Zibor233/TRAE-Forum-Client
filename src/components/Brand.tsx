import TraeLogo from './Logo'

export default function Brand() {
  return <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
    <TraeLogo className="h-5 w-[26px] shrink-0 text-accent" />
    <span className="inline-flex items-end gap-1">
      <span className="text-[16px] font-bold leading-5 tracking-tight text-ink">TRAE社区</span>
      <span className="mb-px rounded-sm bg-accent-fill px-0.5 py-0.5 text-[7px] font-medium leading-none text-white">第三方客户端</span>
    </span>
  </span>
}
