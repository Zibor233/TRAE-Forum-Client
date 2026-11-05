export interface Tag {
  id: number
  name: string
  slug: string
}

export interface Poster {
  user_id: number
  description: string
  extras?: string
}

export interface Topic {
  id: number
  title: string
  fancy_title?: string
  slug?: string
  /** regular / private_message 等；私信话题不应出现在公开信息流 */
  archetype?: string
  posts_count: number
  reply_count?: number
  like_count?: number
  views?: number
  created_at: string
  last_posted_at?: string
  bumped_at?: string
  category_id?: number
  user_id?: number
  tags?: Tag[]
  image_url?: string | null
  thumbnails?: { max_width: number; max_height: number; width: number; height: number; url: string }[] | null
  excerpt?: string
  pinned?: boolean
  pinned_globally?: boolean
  closed?: boolean
  archived?: boolean
  has_accepted_answer?: boolean
  last_poster_username?: string
  posters?: Poster[]
  participants?: ForumUser[]
  unread_posts?: number
  new_posts?: number
  unseen?: boolean
}

export interface ForumUser {
  id: number
  username: string
  name?: string
  avatar_template?: string
  admin?: boolean
  moderator?: boolean
  primary_group_name?: string | null
  trust_level?: number
}

export interface TopicList {
  topics: Topic[]
  users?: ForumUser[]
  more_topics_url?: string | null
  per_page?: number
  tags?: { id?: number; name: string; slug?: string }[]
}

export interface TagItem {
  id?: number
  name: string
  slug?: string
  topic_count?: number
  text_color?: string
  color?: string
}

export interface NotificationItem {
  id: number
  notification_type: number
  read: boolean
  created_at: string
  topic_id?: number
  post_number?: number
  slug?: string
  acting_user_id?: number
  data?: {
    topic_title?: string
    display_username?: string
    original_post_id?: number
    original_username?: string
    original_post_type?: number
    badge_name?: string
    group_name?: string
    username?: string
    username1?: string
    message?: string
    excerpt?: string
    [key: string]: unknown
  }
}

export interface UserProfile {
  id: number
  username: string
  name?: string
  avatar_template?: string
  title?: string | null
  can_edit_username?: boolean
  can_edit_name?: boolean
  can_edit_avatar?: boolean
  can_upload_avatar?: boolean
  can_change_bio?: boolean
  can_change_location?: boolean
  can_upload_user_card_background?: boolean
  location?: string
  card_background_upload_url?: string | null
  featured_topic?: { id: number; title: string } | null
  user_option?: { timezone?: string; hide_profile?: boolean }
  bio_raw?: string | null
  bio_excerpt?: string | null
  created_at?: string
  last_seen_at?: string | null
  trust_level?: number
  admin?: boolean
  moderator?: boolean
  profile_view_count?: number
  badge_count?: number
  post_count?: number
  topic_count?: number
  likes_received?: number
  likes_given?: number
  time_read?: number
  profile_hidden?: boolean
  can_send_private_message_to_user?: boolean
  primary_group_name?: string | null
}

export interface UserActionItem {
  id?: number
  topic_id: number
  post_number?: number
  title?: string
  excerpt?: string
  created_at?: string
  username?: string
  avatar_template?: string
  acting_username?: string
  acting_avatar_template?: string
  action_type?: number
}

export interface BookmarkItem {
  id: number
  topic_id: number
  post_number?: number
  title?: string
  excerpt?: string
  created_at?: string
  username?: string
  avatar_template?: string
}

export interface EmojiItem {
  name: string
  url: string
  group?: string
}

export interface EmojiGroup {
  name: string
  emojis: EmojiItem[]
}

export interface UploadResult {
  id?: number
  url: string
  short_url?: string
  short_path?: string
  width?: number
  height?: number
  extension?: string
  filesize?: number
  human_filesize?: string
  errors?: string[]
}

export interface Category {
  id: number
  name: string
  color: string
  text_color: string
  slug: string
  topic_count: number
  description?: string
  description_text?: string
  parent_category_id?: number | null
  subcategory_ids?: number[]
  subcategory_list?: Category[]
  uploaded_logo?: { url: string; width?: number; height?: number } | null
  uploaded_background?: { url: string; width?: number; height?: number } | null
  read_restricted?: boolean
  has_children?: boolean
  unread_count?: number
  new_posts?: number
}

export interface ActionSummary {
  id: number
  count?: number
  acted?: boolean
}

export interface Reaction {
  id: string
  type?: string
  count: number
}

export interface Post {
  id: number
  post_number: number
  username: string
  name?: string
  display_username?: string
  created_at: string
  cooked: string
  avatar_template?: string
  like_count?: number | null
  actions_summary?: ActionSummary[]
  reactions?: Reaction[]
  reaction_users_count?: number
  reply_to_user?: { username: string; name?: string; avatar_template?: string } | null
  reply_to_post_number?: number | null
  post_type: number
  topic_id: number
  topic_slug?: string
  staff?: boolean
  admin?: boolean
  moderator?: boolean
  user_title?: string | null
  accepted_answer?: boolean
  hidden?: boolean
  deleted_at?: string | null
}

export interface Participant {
  id: number
  username: string
  name?: string
  avatar_template?: string
  post_count: number
}

export interface TopicDetail extends Topic {
  post_stream: {
    posts: Post[]
    stream: number[]
  }
  details?: {
    participants?: Participant[]
    can_create_topic?: boolean
    created_by?: Participant
  }
  word_count?: number
}

export interface SearchPost {
  topic_id: number
  post_number: number
  username: string
  blurb: string
  created_at?: string
}

/* ----------------------------- discourse-chat ----------------------------- */

export interface ChatUser {
  id: number
  username: string
  name?: string
  avatar_template?: string
}

export interface ChatUpload {
  id: number
  url: string
  original_filename?: string
  width?: number
  height?: number
  extension?: string
  thumbnail?: { url?: string; width?: number; height?: number } | null
}

export interface ChatMessage {
  pinned?: boolean
  edited?: boolean
  in_reply_to?: { id: number; user?: ChatUser; excerpt?: string }
  reactions?: { emoji: string; count: number; reacted?: boolean }[]
  id: number
  message: string
  cooked?: string
  excerpt?: string
  created_at: string
  thread_id?: number | null
  chat_channel_id: number
  user: ChatUser
  uploads?: ChatUpload[]
  streaming?: boolean
}

export interface ChatChannel {
  id: number
  title?: string
  unicode_title?: string
  chatable_type?: string
  chatable_id?: number
  chatable?: { name?: string; users?: ChatUser[]; group?: boolean }
  memberships_count?: number
  status?: string
  current_user_membership?: {
    last_read_message_id?: number
    notification_level?: number | string
  } | null
  last_message?: Partial<ChatMessage> | null
  meta?: Record<string, unknown>
}

export interface ChatMessagesMeta {
  target_message_id?: number | null
  can_load_more_past?: boolean | null
  can_load_more_future?: boolean | null
}

export interface ChatOverview {
  public_channels?: ChatChannel[]
  direct_message_channels?: ChatChannel[]
  meta?: { can_load_more_public?: boolean; can_load_more_direct?: boolean }
}

export interface ChatMessagesResponse {
  messages: ChatMessage[]
  meta?: ChatMessagesMeta
}

export interface SearchResult {
  topics?: Topic[]
  posts?: SearchPost[]
  grouped_search_result?: {
    term?: string
    more_full_page_results?: boolean
    error?: string | null
  }
  error?: string | null
}
