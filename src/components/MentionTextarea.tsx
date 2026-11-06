import { forwardRef, useEffect, useId, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { searchMentionUsers } from '../api'
import type { ForumUser } from '../types'
import Avatar from './Avatar'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & { apiKey?: string; onValueChange: (value: string) => void }
export default forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea({ apiKey, onValueChange, ...props }, forwarded) {
  const input = useRef<HTMLTextAreaElement | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const [range, setRange] = useState<{start:number;end:number;term:string} | null>(null)
  const [users, setUsers] = useState<ForumUser[]>([])
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState('')
  const [position, setPosition] = useState({left:0,top:0,width:280,above:true,height:240})
  const detect = () => {
    const el = input.current
    if (!el || el.selectionStart !== el.selectionEnd) { setRange(null); return }
    const before = el.value.slice(0,el.selectionStart)
    const match = before.match(/(?:^|[\s（(])@([^\s@]{0,40})$/u)
    if (!match) { setRange(null); return }
    const rect = el.getBoundingClientRect()
    const above = rect.top > 180
    setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-296)),top:above?rect.top-8:rect.bottom+8,width:Math.min(360,window.innerWidth-16),above,height:Math.min(240,above?rect.top-16:window.innerHeight-rect.bottom-16)})
    const next = {start:el.selectionStart-match[1].length-1,end:el.selectionStart,term:match[1]}
    setRange(old => old?.start===next.start && old?.end===next.end && old?.term===next.term ? old : next)
  }
  useEffect(() => {
    setUsers([]); setIndex(0)
    if (!range) { setStatus(''); return }
    if (!range.term) { setStatus('输入用户名搜索'); return }
    setStatus('搜索中…')
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchMentionUsers(range.term, apiKey, controller.signal).then(result => {
        if (!controller.signal.aborted) { setUsers(result.users || []); setStatus(result.users?.length ? '' : '没有找到用户') }
      }).catch(() => { if (!controller.signal.aborted) setStatus('搜索失败，请重新输入') })
    },250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [range, apiKey])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'}) },[index])
  useEffect(() => {
    const close = (event: Event) => { if (event.target instanceof Node && list.current?.contains(event.target)) return; setRange(null) }
    window.addEventListener('scroll',close,true); window.addEventListener('resize',close)
    return () => { window.removeEventListener('scroll',close,true); window.removeEventListener('resize',close) }
  },[])
  const choose = (user: ForumUser) => {
    const el=input.current
    if (!range || !el) return
    const text = `@${user.username} `
    onValueChange(el.value.slice(0,range.start)+text+el.value.slice(range.end))
    const caret=range.start+text.length
    setRange(null)
    requestAnimationFrame(()=>{el.focus();el.setSelectionRange(caret,caret)})
  }
  return <><textarea {...props} ref={el => {input.current=el; if (typeof forwarded==='function') forwarded(el); else if (forwarded) forwarded.current=el}} aria-autocomplete="list" aria-controls={range?id:undefined} aria-expanded={Boolean(range)}
    onChange={event=>{onValueChange(event.target.value);detect()}}
    onSelect={event=>{props.onSelect?.(event);detect()}}
    onBlur={event=>{props.onBlur?.(event);setRange(null)}}
    onKeyDown={event=>{
      if (range && !event.nativeEvent.isComposing) {
        if (event.key==='Escape') {event.preventDefault();event.stopPropagation();setRange(null);return}
        if (users.length && ['ArrowDown','ArrowUp','Enter','Tab'].includes(event.key)) {
          event.preventDefault();event.stopPropagation()
          if (event.key==='ArrowDown') setIndex(value=>(value+1)%users.length)
          else if(event.key==='ArrowUp') setIndex(value=>(value-1+users.length)%users.length)
          else choose(users[index])
          return
        }
      }
      props.onKeyDown?.(event)
    }}/>
    {range && createPortal(<div ref={list} id={id} role="listbox" aria-label="选择提及用户" style={{position:'fixed',left:position.left,top:position.top,width:position.width,maxHeight:position.height,transform:position.above?'translateY(-100%)':undefined}} className="z-[200] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-ink shadow-lg" onMouseDown={event=>event.preventDefault()}>
      {status && <p className="px-3 py-2 text-xs text-sub">{status}</p>}
      {users.map((user,i)=><button type="button" role="option" aria-selected={i===index} key={user.id || user.username} onPointerMove={()=>setIndex(i)} onClick={()=>choose(user)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${i===index?'bg-soft':''}`}><Avatar size={28} template={user.avatar_template} name={user.name||user.username}/><span className="truncate">{user.username}<span className="ml-2 text-xs text-sub">{user.name}</span></span></button>)}
    </div>,document.body)}
  </>
})
