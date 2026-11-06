import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { startProxy } from '../proxy/server.mjs'

test('public coalescing, cache refresh, auth isolation and write invalidation', async () => {
  const realFetch = globalThis.fetch
  const realNow = Date.now
  let offset = 0
  Date.now = () => realNow() + offset
  let calls = 0
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://forum.trae.cn')) return realFetch(url, options)
    calls++
    await new Promise(resolve => setTimeout(resolve, 30))
    return new Response(JSON.stringify({ call: calls, user: options.headers['user-api-key'] || null }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
    })
  }
  const server = startProxy(0)
  try {
    await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}/api`
    const pair = await Promise.all([realFetch(`${base}/latest.json`), realFetch(`${base}/latest.json`)])
    await Promise.all(pair.map(r => r.json()))
    assert.equal(calls, 1, 'concurrent cold reads share one upstream request')
    let res = await realFetch(`${base}/latest.json`)
    assert.equal(res.headers.get('x-proxy-cache'), 'HIT')
    await res.json()
    offset = 61_000
    res = await realFetch(`${base}/latest.json`)
    assert.equal(res.headers.get('x-proxy-cache'), 'STALE')
    await res.json()
    await new Promise(resolve => setTimeout(resolve, 60))
    res = await realFetch(`${base}/latest.json`)
    assert.equal(res.headers.get('x-proxy-cache'), 'HIT')
    await res.json()
    const before = calls
    const anonymousTimings = await realFetch(`${base}/topics/timings.json`, { method: 'POST', body: '{}' })
    assert.equal(anonymousTimings.status, 401, 'anonymous clients cannot report reading time')
    const timings = await realFetch(`${base}/topics/timings.json`, {
      method: 'POST', headers: { 'user-api-key': 'A', 'content-type': 'application/json' },
      body: JSON.stringify({ topic_id: 123, topic_time: 1000, timings: { 1: 1000 } }),
    })
    assert.equal(timings.status, 200)
    await timings.json()
    res = await realFetch(`${base}/latest.json`)
    assert.equal(res.headers.get('x-proxy-cache'), 'HIT', 'reading reports preserve public feed caches')
    await res.json()
    const privateReads = await Promise.all(['A', 'B'].map(key => realFetch(`${base}/latest.json`, { headers: { 'user-api-key': key } }).then(r => r.json())))
    assert.deepEqual(privateReads.map(r => r.user), ['A', 'B'])
    assert.equal(calls, before + 3, 'authenticated reads are not shared')
    await realFetch(`${base}/posts.json`, { method: 'POST', headers: { 'user-api-key': 'A', 'content-type': 'application/json' }, body: '{}' }).then(r => r.json())
    res = await realFetch(`${base}/latest.json`)
    assert.equal(res.headers.get('x-proxy-cache'), 'MISS', 'successful writes invalidate cached reads')
    await res.json()
  } finally {
    globalThis.fetch = realFetch
    Date.now = realNow
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})


test('profile proxy permits only the intended profile write routes and requires authentication', async () => {
  const realFetch = globalThis.fetch
  const upstream = []
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://forum.trae.cn')) return realFetch(url, options)
    upstream.push({ url: String(url), ...options })
    return new Response('{"success":"OK"}', { headers: { 'content-type': 'application/json' } })
  }
  const server = startProxy(0)
  try {
    await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}/api`
    const paths = ['/u/alice.json', '/u/alice/preferences/username', '/u/alice/preferences/avatar/pick', '/u/alice/feature-topic', '/u/alice/clear-featured-topic']
    for (const path of paths) {
      const result = await realFetch(`${base}${path}`, { method: 'PUT', headers: { 'user-api-key': 'profile-key', 'content-type': 'application/json' }, body: '{}' })
      assert.equal(result.status, 200, path)
      await result.json()
    }
    assert.equal(upstream.length, paths.length)
    const forbidden = await realFetch(`${base}/u/alice/preferences/email`, { method: 'PUT', headers: { 'user-api-key': 'profile-key' }, body: '{}' })
    assert.ok(forbidden.status >= 400)
    const anonymous = await realFetch(`${base}/u/alice.json`, { method: 'PUT', body: '{}' })
    assert.ok(anonymous.status >= 400)
    assert.equal(upstream.length, paths.length)
  } finally {
    globalThis.fetch = realFetch
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('bookmark and notification writes pass the whitelist and still require login', async () => {
  const realFetch = globalThis.fetch
  const upstream = []
  globalThis.fetch = async (url, options) => {
    upstream.push({url: String(url), ...options})
    return new Response('{"id":123,"success":"OK"}', {headers:{'content-type':'application/json'}})
  }
  const server = startProxy(0)
  try {
    await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}/api`
    for (const [method, path] of [['POST','/bookmarks.json'],['DELETE','/bookmarks/123.json'],['PUT','/notifications/mark-read.json']]) {
      const anonymous = await realFetch(base+path, {method})
      assert.equal(anonymous.status, 401)
      const result = await realFetch(base+path, {method, headers:{'user-api-key':'test-key','content-type':'application/json'}, ...(method === 'DELETE' ? {} : {body:'{}'})})
      assert.equal(result.status, 200)
    }
    assert.equal(upstream.length, 3)
    for (const request of upstream) assert.equal(request.headers['user-api-key'], 'test-key')
    const denied = await realFetch(base+'/bookmarks/bulk.json', {method:'POST', headers:{'user-api-key':'test-key'}})
    assert.equal(denied.status, 405)
    assert.equal(upstream.length, 3)
  } finally {
    globalThis.fetch = realFetch
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
