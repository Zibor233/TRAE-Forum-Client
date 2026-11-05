import type { Topic } from '../types'

export interface FeedOptions { order?: string; tags?: string[]; noTags?: boolean; topPeriod?: string | null }
export function feedPath(categoryId: number | null, page: number, options: FeedOptions = {}) {
  const query = new URLSearchParams({ page: String(page), order: options.order || 'default' })
  if (categoryId !== null) query.set('category', String(categoryId))
  if (options.noTags) query.set('no_tags', 'true')
  else if (options.tags?.length) {
    for (const tag of options.tags) query.append('tags[]', tag)
    query.set('match_all_tags', 'true')
  }
  if (options.topPeriod) query.set('period', options.topPeriod)
  return `${options.topPeriod ? '/top.json' : '/latest.json'}?${query}`
}
export function topicRevision(topic: Topic) {
  return [topic.bumped_at || topic.last_posted_at || topic.created_at, topic.posts_count, topic.title].join('|')
}
export function changedTopics(baseline: Map<number, string>, latest: Topic[]) {
  return latest.filter(topic => topic.archetype !== 'private_message' && baseline.get(topic.id) !== topicRevision(topic))
}
