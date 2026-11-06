import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { isNewerVersion, selectRelease, checkForUpdates } from '../desktop/updates.mjs'

const compiled = ts.transpileModule(await readFile(new URL('../src/lib/feed.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { feedPath, topicRevision, changedTopics } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('tag filters survive category, sorting and pagination and encode tag names safely', () => {
  const path = new URL(feedPath(null, 2, { tags: ['生活娱乐', 'a&b'] }), 'https://example.test')
  assert.equal(path.pathname, '/latest.json')
  assert.deepEqual(path.searchParams.getAll('tags[]'), ['生活娱乐', 'a&b'])
  assert.equal(path.searchParams.get('match_all_tags'), 'true')
  assert.equal(path.searchParams.get('page'), '2')
  const top = new URL(feedPath(9, 0, { topPeriod: 'monthly', noTags: true, tags: ['ignored'] }), path)
  assert.equal(top.pathname, '/top.json')
  assert.equal(top.searchParams.get('category'), '9')
  assert.equal(top.searchParams.get('no_tags'), 'true')
  assert.equal(top.searchParams.has('tags[]'), false)
})

test('new-topic hint detects new posts and changed threads while excluding private messages', () => {
  const topic = { id: 1, title: 'A', created_at: '2026-11-01', posts_count: 1 }
  const baseline = new Map([[1, topicRevision(topic)]])
  assert.deepEqual(changedTopics(baseline, [topic]), [])
  assert.deepEqual(changedTopics(baseline, [{ ...topic, posts_count: 2 }, { ...topic, id: 2 }, { ...topic, id: 3, archetype: 'private_message' }]).map(t => t.id), [1, 2])
})

test('update comparison recognizes the public Beta tag and does not downgrade stable clients', () => {
  assert.equal(isNewerVersion('v0.1.0Beta', '0.1.0-beta.1'), false)
  assert.equal(isNewerVersion('v0.1.0', '0.1.0-beta.1'), true)
  assert.equal(isNewerVersion('v0.2.0Beta', '0.1.0'), true)
  assert.equal(isNewerVersion('invalid', '0.1.0'), false)
  const releases = [{ tag_name: 'v0.2.0Beta', prerelease: true }, { tag_name: 'v0.1.1', prerelease: false }, { tag_name: 'v9.0.0', draft: true }]
  assert.equal(selectRelease(releases, '0.1.0').tag_name, 'v0.1.1')
  assert.equal(selectRelease(releases, '0.1.0-beta.1').tag_name, 'v0.2.0Beta')
})

test('background update checks coalesce, cache results and never attach forum credentials', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++
    assert.match(url, /^https:\/\/api.github.com\/repos\/Zibor233\//)
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.headers['user-api-key'], undefined)
    return new Response(JSON.stringify([{ tag_name: 'v0.2.0Beta', prerelease: true }]))
  }
  try {
    const [first, second] = await Promise.all([checkForUpdates(), checkForUpdates()])
    assert.equal(first.version, 'v0.2.0Beta')
    assert.deepEqual(second, first)
    await checkForUpdates()
    assert.equal(calls, 1)
    await checkForUpdates(true)
    assert.equal(calls, 2, 'manual checks bypass cached results')
    globalThis.fetch = async () => { throw new Error('offline') }
    assert.match((await checkForUpdates(true)).error, /检测更新失败/)
  } finally { globalThis.fetch = original }
})
