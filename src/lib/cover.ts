/**
 * 无图话题的文字封面文案：取正文第一句（列表接口给的是 excerpt，即 cooked 的纯文本摘要）。
 * 中文句末标点切句；首句不足 12 字时并上第二句；超过 24 字截断加省略号。
 */
export function textCoverText(topic: { excerpt?: string }): string | null {
  const raw = (topic.excerpt || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/:[a-z0-9_+-]+:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return null

  const sentences = raw.split(/(?<=[。！？；!?;\n])/).map((part) => part.trim()).filter(Boolean)
  let text = sentences[0] || raw
  if ([...text].length < 12) {
    for (const next of sentences.slice(1)) {
      text += next
      if ([...text].length >= 12) break
    }
  }
  text = text.replace(/[。；;\s]+$/, '')
  const chars = [...text]
  return chars.length > 24 ? `${chars.slice(0, 24).join('')}…` : text
}

