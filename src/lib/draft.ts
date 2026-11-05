export interface TopicDraft {
  title: string
  raw: string
  categoryId: number | null
  tags: string[]
}
const key = (username: string) => `trae-lite.topic-draft.v1:${encodeURIComponent(username)}`
export function readDraft(username: string): TopicDraft | null {
  try {
    const data = JSON.parse(localStorage.getItem(key(username)) || 'null')
    if (!data || typeof data.title !== 'string' || typeof data.raw !== 'string' ||
        !Array.isArray(data.tags) || !data.tags.every((tag: unknown) => typeof tag === 'string') ||
        !(data.categoryId === null || Number.isInteger(data.categoryId))) return null
    return data
  } catch { return null }
}
export function saveDraft(username: string, draft: TopicDraft): boolean {
  try {
    if (!draft.title.trim() && !draft.raw.trim() && !draft.tags.length) localStorage.removeItem(key(username))
    else localStorage.setItem(key(username), JSON.stringify(draft))
    return true
  } catch { return false }
}
export function clearDraft(username: string) {
  try { localStorage.removeItem(key(username)) } catch { /* optional storage */ }
}
