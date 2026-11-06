import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

async function loadTS(path, transform = s => s) {
  const source = await fs.readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
  let compiled = transform(outputText)
  if (compiled.includes("from './lib/feed'")) {
    const feed = ts.transpileModule(await fs.readFile(new URL('../src/lib/feed.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    compiled = compiled.replace("'./lib/feed'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(feed).toString('base64')))
  }
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('likes restore acted state and isolate persisted topic state by account', async () => {
  const originalStorage = globalThis.localStorage
  const originalWindow = globalThis.window
  const values = new Map()
  globalThis.localStorage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) }
  globalThis.window = new EventTarget()
  try {
    const likes = await loadTS('../src/lib/likes.ts')
    assert.equal(likes.postLiked({ actions_summary: [{ id: 2, acted: true }] }), true)
    assert.equal(likes.postLiked({ actions_summary: [{ id: 2, count: 10 }] }), false)
    likes.publishTopicLike('alice', 123, true, 11)
    assert.equal(likes.readTopicLike('alice', 123).liked, true)
    assert.equal(likes.readTopicLike('bob', 123), null)
    likes.publishTopicLike('alice', 123, false, 10)
    assert.equal(likes.readTopicLike('alice', 123).count, 10)
  } finally {
    globalThis.localStorage = originalStorage
    globalThis.window = originalWindow
  }
})

test('like and unlike send the post ID and preserve server action state', async () => {
  const realFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (path, options) => {
    requests.push({ path, ...options })
    return new Response(JSON.stringify({ id: 987, actions_summary: [{ id: 2, count: 5, acted: options.method === 'POST' }] }))
  }
  try {
    const api = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = run => run(); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {};'))
    assert.equal((await api.likePost('test-key', 987)).actions_summary[0].acted, true)
    assert.equal((await api.unlikePost('test-key', 987)).actions_summary[0].acted, false)
    assert.equal(JSON.parse(requests[0].body).id, 987)
    assert.equal(requests[1].path, '/api/post_actions/987?post_action_type_id=2')
    assert.equal(requests[1].headers['user-api-key'], 'test-key')
  } finally { globalThis.fetch = realFetch }
})

test('chat cancellation exits immediately even while the network queue is blocked', async () => {
  const api = await loadTS('../src/api.ts', source => source
    .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = () => new Promise(() => {}); const dedupe = (key, run) => run();')
    .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {};'))
  const controller = new AbortController()
  const pending = api.fetchChatChannels('test-key', controller.signal)
  controller.abort(new DOMException('Cancelled', 'AbortError'))
  await assert.rejects(pending, { name: 'AbortError' })
})

test('chat loads latest by default, paginates with cursors, and sends attachment and action payloads', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options })
    return new Response(JSON.stringify({ messages: [], message_id: 999 }))
  }
  try {
    const api = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = run => run(); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {};'))
    await api.fetchChatMessages(42, 'test', { pageSize: 50 })
    assert.equal(new URL(calls.at(-1).url, 'http://localhost').searchParams.has('direction'), false)
    await api.fetchChatMessages(42, 'test', { beforeId: 500 })
    assert.match(calls.at(-1).url, /direction=past&target_message_id=500/)
    await api.fetchChatMessages(42, 'test', { aroundId: 999 })
    assert.match(calls.at(-1).url, /target_message_id=999/)
    assert.equal(new URL(calls.at(-1).url, 'http://localhost').searchParams.has('direction'), false)
    await api.sendChatMessage(42, 'test', '', [123])
    assert.deepEqual(JSON.parse(calls.at(-1).body), { message: '', upload_ids: [123] })
    await api.editChatMessage(42, 999, 'test', 'edited', [123])
    assert.equal(calls.at(-1).method, 'PUT')
    assert.equal(calls.at(-1).url, '/api/chat/api/channels/42/messages/999')
    await api.pinChatMessage(42, 999, 'test', true)
    assert.equal(calls.at(-1).method, 'POST')
    await api.pinChatMessage(42, 999, 'test', false)
    assert.equal(calls.at(-1).method, 'DELETE')
    await api.deleteChatMessage(42, 999, 'test')
    assert.equal(calls.at(-1).method, 'DELETE')
    await api.rebakeChatMessage(42, 999, 'test')
    assert.equal(calls.at(-1).url, '/api/chat/42/999/rebake')
    assert.equal(calls.at(-1).method, 'PUT')
  } finally { globalThis.fetch = original }
})

test('liker list requests the post actors with account permissions and pagination', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options })
    return new Response(JSON.stringify({ post_action_users: [{ id: 5, username: 'alice' }], total_rows_post_action_users: 40 }))
  }
  try {
    const api = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = run => run(); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {};'))
    const result = await api.fetchPostLikers(987, 'test-key', 1)
    assert.equal(calls[0].url, '/api/post_action_users.json?id=987&post_action_type_id=2&page=1&limit=30')
    assert.equal(calls[0].headers['user-api-key'], 'test-key')
    assert.equal(result.post_action_users[0].username, 'alice')
  } finally { globalThis.fetch = original }
})

test('profile notes cache is account-scoped and profile requests time out even in a blocked queue', async () => {
  const originalFetch = globalThis.fetch
  const originalTimeout = globalThis.setTimeout
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ topic_list: { topics: [{ id: 123 }], more_topics_url: null }, users: [{ id: 5, username: 'alice' }] }))
    const api = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = run => run(); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {};'))
    await api.fetchCreatedTopics('alice', 0, 'account-A')
    assert.equal(api.peekCreatedTopics('alice', 0, 'account-A').topics[0].id, 123)
    assert.equal(api.peekCreatedTopics('alice', 0, 'account-A').users[0].username, 'alice')
    assert.equal(api.peekCreatedTopics('alice', 0, 'account-B'), null)
    assert.equal(api.peekCreatedTopics('bob', 0, 'account-A'), null)
    const blocked = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = () => new Promise(() => {}); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {};'))
    globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 25000 ? 0 : ms, ...args)
    await assert.rejects(blocked.fetchCreatedTopics('alice', 0, 'account-A'), { name: 'TimeoutError' })
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalTimeout
  }
})

test('private topics and direct chats use distinct endpoints and payloads', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options })
    return new Response(JSON.stringify({ topic_id: 123, channel: { id: 456 } }))
  }
  try {
    const api = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = run => run(); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {};'))
    await api.createPrivateMessage('test-key', 'alice', '标题', '正文')
    assert.equal(calls[0].url, '/api/posts.json')
    assert.deepEqual(JSON.parse(calls[0].body), { archetype: 'private_message', target_recipients: 'alice', title: '标题', raw: '正文' })
    await api.createDirectChat('test-key', 'alice')
    assert.equal(calls[1].url, '/api/chat/api/direct-message-channels')
    assert.deepEqual(JSON.parse(calls[1].body), { target_usernames: ['alice'], upsert: true })
    assert.equal(calls[1].headers['user-api-key'], 'test-key')
  } finally { globalThis.fetch = original }
})


test('profile changes use dedicated rename, avatar and featured topic routes with authenticated uploads', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options })
    return new Response(JSON.stringify(url.endsWith('uploads.json') ? { id: 7, url: '/uploads/avatar.png' } : { user: { username: 'alice', name: 'Alice' }, username: 'new-alice' }))
  }
  try {
    const api = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = run => run(); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {};'))
    await api.updateUserProfile('alice', 'key-profile', { name: 'Alice', title: '', bio_raw: '**Hello**', hide_profile: false, timezone: 'Asia/Shanghai', location: '上海', card_background_upload_url: '' })
    await api.changeUsername('alice', 'key-profile', 'new-alice')
    await api.pickUserAvatar('new-alice', 'key-profile', 7)
    await api.featureUserTopic('new-alice', 'key-profile', 123)
    await api.featureUserTopic('new-alice', 'key-profile', null)
    await api.uploadImage('key-profile', new Blob(['image'], { type: 'image/png' }), 'avatar')
    assert.deepEqual(calls.slice(0, 5).map(c => [c.url, c.method]), [
      ['/api/u/alice.json', 'PUT'], ['/api/u/alice/preferences/username', 'PUT'],
      ['/api/u/new-alice/preferences/avatar/pick', 'PUT'], ['/api/u/new-alice/feature-topic', 'PUT'],
      ['/api/u/new-alice/clear-featured-topic', 'PUT'],
    ])
    assert.deepEqual(JSON.parse(calls[1].body), { new_username: 'new-alice' })
    assert.deepEqual(JSON.parse(calls[2].body), { upload_id: 7, type: 'custom' })
    assert.deepEqual(JSON.parse(calls[3].body), { topic_id: 123 })
    assert.equal(JSON.parse(calls[0].body).hide_profile, false)
    assert.equal(JSON.parse(calls[0].body).card_background_upload_url, '')
    assert.equal(calls[5].body.get('upload_type'), 'avatar')
    assert.equal(calls[5].body.get('type'), 'avatar')
    assert.ok(calls.every(c => c.headers['user-api-key'] === 'key-profile'))
  } finally { globalThis.fetch = original }
})


test('non-topic notifications describe badges and groups and resolve safe destinations', async () => {
  const { notificationDetails } = await loadTS('../src/lib/notificationDetails.ts')
  const base = { id: 1, read: false, created_at: '2026-11-05' }
  let result = notificationDetails({ ...base, notification_type: 12, data: { badge_id: '7', badge_name: '版主' } }, 'alice')
  assert.equal(result.name, '徽章通知')
  assert.equal(result.label, '你获得了「版主」徽章')
  assert.equal(result.href, 'https://forum.trae.cn/badges/7?username=alice')
  result = notificationDetails({ ...base, notification_type: 22, data: { group_name: '社区用户' } }, 'alice')
  assert.equal(result.label, '你的加入申请已通过')
  assert.equal(result.href, 'https://forum.trae.cn/g/%E7%A4%BE%E5%8C%BA%E7%94%A8%E6%88%B7')
  result = notificationDetails({ ...base, notification_type: 16, data: { group_name: 'staff' } }, 'alice')
  assert.equal(result.href, 'https://forum.trae.cn/u/alice/messages/group/staff')
  result = notificationDetails({ ...base, notification_type: 30, data: { chat_channel_id: 9, chat_message_id: 12 } }, 'alice')
  assert.equal(result.href, 'https://forum.trae.cn/chat/c/-/9/12')
  for (const url of ['javascript:alert(1)', 'https://evil.example/a', '//evil.example/a']) {
    result = notificationDetails({ ...base, notification_type: 14, data: { url } }, 'alice')
    assert.equal(result.href, 'https://forum.trae.cn/u/alice/notifications')
  }
  result = notificationDetails({ ...base, notification_type: 14, data: { url: '/g/staff' } }, 'alice')
  assert.equal(result.href, 'https://forum.trae.cn/g/staff')
  result = notificationDetails({ ...base, notification_type: 2, data: { topic_id: '123' } }, 'alice')
  assert.equal(result.topicId, 123)
})

test('mark all notifications read authenticates one bulk request and preserves failures', async () => {
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => { requests.push({ url, ...options }); return new Response('{"success":"OK"}') }
  try {
    const api = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = run => run(); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {}; const removeCache = () => {};'))
    await api.markAllNotificationsRead('test-key')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/api/notifications/mark-read.json')
    assert.equal(requests[0].method, 'PUT')
    assert.equal(requests[0].headers['user-api-key'], 'test-key')
    assert.deepEqual(JSON.parse(requests[0].body), {})
    globalThis.fetch = async () => new Response('{"errors":["permission denied"]}', { status: 403 })
    await assert.rejects(api.markAllNotificationsRead('test-key'), error => error.status === 403)
  } finally { globalThis.fetch = original }
})

test('bookmarks use the first post ID to create and the returned bookmark ID to delete', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return new Response('{"id":321}') }
  try {
    const api = await loadTS('../src/api.ts', source => source
      .replace(/import .* from ['"].*requestQueue['"];?/, 'const enqueue = run => run(); const dedupe = (key, run) => run();')
      .replace(/import .* from ['"].*cache['"];?/, 'const readCache = () => null; const writeCache = () => {}; const removeCache = () => {};'))
    const bookmark = await api.createBookmark('test-key', 987)
    await api.deleteBookmark('test-key', bookmark.id)
    assert.deepEqual(JSON.parse(calls[0].body), { bookmarkable_id: 987, bookmarkable_type: 'Post' })
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].headers['user-api-key'], 'test-key')
    assert.equal(calls[1].url, '/api/bookmarks/321.json')
    assert.equal(calls[1].method, 'DELETE')
    globalThis.fetch = async () => new Response('{"errors":["permission denied"]}', { status: 403 })
    await assert.rejects(api.createBookmark('test-key', 987), error => error.status === 403)
  } finally { globalThis.fetch = original }
})

test('article images prefer the lightbox original and otherwise select the largest source', async () => {
  const { articleImageSource } = await loadTS('../src/lib/format.ts')
  const image = (attrs, href, lightbox = false) => ({
    getAttribute: key => attrs[key] || null,
    closest: () => href ? { classList: { contains: () => lightbox }, getAttribute: () => href } : null,
  })
  assert.equal(articleImageSource(image({src:'/optimized/small.jpeg',srcset:'/optimized/large.jpeg 1200w'}, '/uploads/original.png', true)), 'https://forum.trae.cn/uploads/original.png')
  assert.equal(articleImageSource(image({src:'/small.png',srcset:'/medium.png 600w, /large.png 1600w'})), 'https://forum.trae.cn/large.png')
  assert.equal(articleImageSource(image({src:'/small.png'}, '/t/123', false)), 'https://forum.trae.cn/small.png')
  assert.equal(articleImageSource(image({'data-orig-src':'javascript:alert(1)'})), '')
})
