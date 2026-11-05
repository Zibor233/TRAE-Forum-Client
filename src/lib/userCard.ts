export const USER_CARD_EVENT = 'trae-lite:user-card'
export function openUserCard(username?: string, action?: 'private' | 'chat') {
  if (username) window.dispatchEvent(new CustomEvent(USER_CARD_EVENT, { detail: action ? { username, action } : username }))
}
