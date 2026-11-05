import { useEffect, useState, type CSSProperties } from 'react'
import { avatarHue, firstChar, resolveAvatar } from '../lib/format'
import { UserIcon } from './icons'

interface AvatarProps {
  template?: string
  name?: string
  size?: number
  neutral?: boolean
  className?: string
}

/** 统一头像：优先真实 avatar_template，其次字母底色，未登录时灰色人形 */
export default function Avatar({ template, name, size = 40, neutral, className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const label = name?.trim() || ''
  const src = neutral ? '' : resolveAvatar(template, size * 2)

  // 换用户/换模板时重置失败标记；onError 只置位一次，不会触发重复请求
  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) {
    if (neutral) {
      return (
        <span
          aria-hidden="true"
          className={`avatar-neutral grid shrink-0 place-items-center rounded-full ${className}`}
          style={{ width: size, height: size }}
        >
          <UserIcon className="h-[64%] w-[64%]" />
        </span>
      )
    }
    const { hue, lightness } = avatarHue(label || '?')
    return (
      <span
        className={`avatar-letter grid shrink-0 place-items-center rounded-full font-medium ${className}`}
        style={
          {
            width: size,
            height: size,
            fontSize: Math.max(10, Math.round(size * 0.34)),
            '--av-h': hue,
            '--av-l': `${lightness}%`,
          } as CSSProperties
        }
      >
        {firstChar(label || '?')}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={`shrink-0 rounded-full bg-soft object-cover ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  )
}
