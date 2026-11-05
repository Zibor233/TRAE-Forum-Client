import { useEffect, useState, type FormEvent } from 'react'
import { SearchIcon } from './icons'

interface SearchBarProps {
  query?: string
  className?: string
}

/** 内容区顶部居中的胶囊搜索框（原顶栏搜索移到这里，宽度贴合内容列） */
export default function SearchBar({ query = '', className = '' }: SearchBarProps) {
  const [value, setValue] = useState(query)

  useEffect(() => {
    setValue(query)
  }, [query])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const q = value.trim()
    if (!q) return
    window.location.hash = `/search?q=${encodeURIComponent(q)}`
  }

  return (
    <form onSubmit={submit} className={`mx-auto w-full max-w-[600px] ${className}`}>
      <label className="flex h-10 min-w-0 items-center gap-2.5 rounded-full bg-paper px-4 transition focus-within:bg-surface focus-within:ring-1 focus-within:ring-line">
        <SearchIcon className="h-4 w-4 shrink-0 text-sub" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="探索更多内容"
          className="w-full min-w-0 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-sub/90"
          aria-label="搜索论坛"
        />
        {value && (
          <button
            type="button"
            onClick={() => setValue('')}
            className="shrink-0 text-xs text-sub hover:text-ink"
            aria-label="清空搜索"
          >
            清空
          </button>
        )}
      </label>
    </form>
  )
}
