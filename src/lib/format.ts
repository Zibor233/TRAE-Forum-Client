const FORUM_ORIGIN = 'https://forum.trae.cn'

/** 头像模板既能是绝对 URL，也可能以 / 或 // 开头 */
export function resolveAvatar(template?: string, size = 48): string {
  if (!template) return ''
  return absolutize(template.replace('{size}', String(size)))
}

/** 兼容旧调用 */
export function avatarUrl(template?: string, size = 48): string {
  return resolveAvatar(template, size)
}

/**
 * 字母头像的色相与深色亮度，按用户名稳定散列。
 * 浅色下由 .avatar-letter 用浅底深字；深色下固定取 22%–30% 的沉稳亮度，
 * 绝不再出现纯黑底。
 */
export function avatarHue(name: string): { hue: number; lightness: number } {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return { hue: hash % 360, lightness: 22 + ((hash >>> 9) % 9) }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function timeAgo(input?: string): string {
  if (!input) return ''
  const time = new Date(input).getTime()
  if (Number.isNaN(time)) return ''
  const diff = Date.now() - time
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`
  const d = new Date(time)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const mm = `${d.getMonth() + 1}`.padStart(2, '0')
  const dd = `${d.getDate()}`.padStart(2, '0')
  return sameYear ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`
}

export function fullDate(input?: string): string {
  if (!input) return ''
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function compactNumber(n?: number): string {
  const value = n ?? 0
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}w`
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(value)
}

export function topicImage(topic: { image_url?: string | null; thumbnails?: { url: string }[] | null }): string | null {
  const thumb = topic.thumbnails?.[0]?.url
  return thumb ? absolutize(thumb) : topic.image_url ? absolutize(topic.image_url) : null
}

export function absolutize(url: string): string {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `${FORUM_ORIGIN}${url}`
  return url
}

export function postLikeCount(post: {
  actions_summary?: { id: number; count?: number }[]
  reactions?: { id: string; count: number }[]
  reaction_users_count?: number
  like_count?: number | null
}): number {
  const like = post.actions_summary?.find((a) => a.id === 2)?.count
  if (typeof like === 'number') return like
  if (typeof post.like_count === 'number') return post.like_count
  if (typeof post.reaction_users_count === 'number') return post.reaction_users_count
  return post.reactions?.reduce((sum, r) => sum + (r.count || 0), 0) ?? 0
}

const COVER_COLORS = [
  ['#FFE3E7', '#C9184A'],
  ['#E8F0FE', '#1A4E9B'],
  ['#E6F7F1', '#046C4E'],
  ['#FFF3D6', '#8A5A00'],
  ['#F3E8FF', '#6B21A8'],
  ['#E7F5FF', '#0B5E8A'],
  ['#FDEEE3', '#A2430A'],
]

export function coverPalette(id: number): { bg: string; fg: string } {
  const [bg, fg] = COVER_COLORS[Math.abs(id) % COVER_COLORS.length]
  return { bg, fg }
}

export function firstChar(title: string): string {
  const clean = title.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s【】「」【】·—…]/gu, '').trim()
  return (clean[0] || title[0] || 'T').toUpperCase()
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i

/** 清洗论坛返回的 cooked HTML：去掉脚本/事件，把 lightbox 图片转成真正的内联图 */
export function sanitizeCooked(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea').forEach((n) => n.remove())

  // 引用标题的头像只是身份装饰，不能按正文图片放大或加入灯箱。
  doc.querySelectorAll('img.avatar, aside.quote .title img, .quote-title img').forEach((image) => image.remove())

  // 先清掉所有内联事件与 javascript: 协议，之后我们只给图片加受控的 onerror
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      if (['href', 'src', 'srcset', 'xlink:href'].includes(name) && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  })

  // Discourse 会把图片包成 <a class="lightbox"><img/><div class="meta">文件名 1080×2460 236 KB</div></a>
  // meta 里的文件名/尺寸/大小是纯文本噪音，先整块去掉
  doc.querySelectorAll('.meta, .filename, .informations').forEach((n) => n.remove())

  doc.body.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href') || ''
    const absolute = absolutize(href)
    const innerImg = anchor.querySelector('img')

    // 包裹图片的 lightbox 链接：展开成纯图片，避免出现蓝色链接下划线
    if (innerImg) {
      anchor.replaceWith(innerImg)
      return
    }

    // 指向图片文件的链接：直接转成图片
    if (absolute && IMAGE_EXT.test(href)) {
      const img = doc.createElement('img')
      img.setAttribute('src', absolute)
      const title = anchor.getAttribute('title') || ''
      img.setAttribute('alt', title.replace(IMAGE_EXT, ''))
      anchor.replaceWith(img)
      return
    }

    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
    if (href.startsWith('/')) anchor.setAttribute('href', absolutize(href))
  })

  const seen = new Set<string>()
  doc.body.querySelectorAll('img').forEach((img) => {
    const rawSrc = img.getAttribute('src') || ''
    if (!rawSrc) {
      img.remove()
      return
    }
    const src = absolutize(rawSrc)
    img.setAttribute('src', src)
    img.setAttribute('referrerpolicy', 'no-referrer')
    img.setAttribute('loading', 'lazy')
    img.removeAttribute('srcset')
    img.removeAttribute('data-src')

    // 表情图保持行内小图
    if ((img.getAttribute('class') || '').includes('emoji')) return

    // 同一张图重复出现时去重
    if (seen.has(src)) {
      const existing = img.closest('.img-box')
      if (existing) existing.remove()
      else img.remove()
      return
    }
    seen.add(src)

    if (img.parentElement?.classList.contains('img-box')) return

    const box = doc.createElement('div')
    box.className = 'img-box'
    const fallback = doc.createElement('div')
    fallback.className = 'img-fallback'
    fallback.textContent = '图片加载失败'
    img.replaceWith(box)
    box.appendChild(img)
    box.appendChild(fallback)
    img.setAttribute('onerror', "this.parentElement.classList.add('failed')")
  })

  // 去掉只剩空壳的 lightbox 容器
  doc.body.querySelectorAll('.lightbox-wrapper').forEach((node) => {
    node.replaceWith(...Array.from(node.childNodes))
  })

  return doc.body.innerHTML
}
