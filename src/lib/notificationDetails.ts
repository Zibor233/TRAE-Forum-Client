import type { NotificationItem } from '../types'

const ORIGIN = 'https://forum.trae.cn'
function id(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Non-topic notifications need their own destination, rather than an inert topic row. */
export function notificationDetails(item: NotificationItem, selfUsername: string) {
  const data = item.data || {}
  const group = text(data.group_name)
  const badge = text(data.badge_name)
  const type = item.notification_type
  const actor = text(data.display_username) || text(data.username1) || text(data.original_username) || text(data.username)
  let name = actor || '论坛通知'
  let label: string | undefined
  let summary: string | undefined
  let href: string | undefined
  if (type === 12) {
    name = '徽章通知'; label = badge ? `你获得了「${badge}」徽章` : '你获得了新徽章'
    summary = '点击查看徽章详情'
    const badgeId = id(data.badge_id)
    if (badgeId) href = `${ORIGIN}/badges/${badgeId}?username=${encodeURIComponent(selfUsername)}`
  } else if (type === 16) {
    name = group || '群组私信'; label = '有新的群组私信'
    if (group) href = `${ORIGIN}/u/${encodeURIComponent(selfUsername)}/messages/group/${encodeURIComponent(group)}`
  } else if (type === 22 || type === 23) {
    name = group || '群组通知'
    label = type === 22 ? '你的加入申请已通过' : '有待处理的加入申请'
    summary = '点击查看群组详情'
    if (group) href = `${ORIGIN}/g/${encodeURIComponent(group)}${type === 23 ? '/requests' : ''}`
  } else if ([29, 30, 31, 32, 33, 40].includes(type)) {
    label = type === 30 ? '发来聊天消息' : type === 31 ? '邀请你加入聊天' : '在聊天中与你互动'
    const channelId = id(data.chat_channel_id)
    const messageId = id(data.chat_message_id)
    if (channelId) href = `${ORIGIN}/chat/c/-/${channelId}${messageId ? `/${messageId}` : ''}`
  }
  // Only trust same-forum URLs supplied by notification plugins.
  if (!href && !item.topic_id) {
    const raw = text(data.link) || text(data.url)
    if (raw) {
      try {
        const url = new URL(raw, ORIGIN)
        if (url.origin === ORIGIN) href = url.href
      } catch { /* Fall back to the official notification list. */ }
    }
  }
  return {
    name, label, summary,
    href: href || `${ORIGIN}/u/${encodeURIComponent(selfUsername)}/notifications`,
    topicId: id(item.topic_id) || id(data.topic_id),
  }
}
