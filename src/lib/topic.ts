import type { ForumUser, Topic } from '../types'

export interface TopicAuthor {
  username: string
  name?: string
  avatarTemplate?: string
  admin?: boolean
  moderator?: boolean
  group?: string | null
}

/**
 * 卡片作者必须是贴主（Original Poster），不是最后回复者。
 * Discourse 的 topic.posters 用 description 标记 OP，users 数组提供头像。
 */
export function resolveTopicAuthor(topic: Topic, users?: ForumUser[]): TopicAuthor {
  const byId = new Map<number, ForumUser>()
  for (const user of users || []) byId.set(user.id, user)

  const posters = topic.posters || []
  const op =
    posters.find(
      (poster) =>
        /原始发帖人|Original Poster/i.test(poster.description || '') &&
        poster.user_id > 0,
    ) ||
    (topic.user_id ? posters.find((poster) => poster.user_id === topic.user_id) : undefined) ||
    posters[0]

  const user = op ? byId.get(op.user_id) : undefined
  // 列表接口返回 users 时以贴主为准；贴主被删除（user_id <= 0）也不退回最后回复人
  const fallbackUsername = byId.size > 0 ? '匿名用户' : topic.last_poster_username || 'TRAE'

  return {
    username: user?.username || fallbackUsername,
    name: user?.name,
    avatarTemplate: user?.avatar_template,
    admin: user?.admin,
    moderator: user?.moderator,
    group: user?.primary_group_name || null,
  }
}

export function authorBadge(author: TopicAuthor): string {
  if (author.admin) return '管理员'
  if (author.moderator) return '版主'
  return author.group || ''
}
