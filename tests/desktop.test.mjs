import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { once } from 'node:events'
import { bundlePath, isAppUrl, externalUrl } from '../desktop/paths.mjs'
import { startProxy } from '../proxy/server.mjs'

test('desktop paths stay within bundle and external links only use web protocols', () => {
  const root = path.resolve('dist')
  assert.equal(bundlePath(root, '/'), path.join(root, 'index.html'))
  assert.equal(bundlePath(root, '/assets/main.js'), path.join(root, 'assets/main.js'))
  for (const value of ['/../package.json', '/%2e%2e/package.json', '/assets/../../secret', '/%00', '/%5csecret', '/%zz']) assert.equal(bundlePath(root, value), null)
  assert.equal(isAppUrl('trae://app/#/me'), true)
  assert.equal(isAppUrl('trae://evil/'), false)
  assert.equal(externalUrl('https://forum.trae.cn/u/alice'), 'https://forum.trae.cn/u/alice')
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'trae://app/', 'https://user:pass@example.com']) assert.equal(externalUrl(value), null)
})

test('desktop API rejects missing or incorrect token before proxying requests', async () => {
  const server = startProxy(0, { accessToken: 'test-desktop-token' })
  try {
    await once(server, 'listening')
    const url = `http://127.0.0.1:${server.address().port}/api/posts.json`
    for (const headers of [{}, { 'x-desktop-token': 'wrong' }]) {
      const response = await fetch(url, { method: 'POST', headers, body: '{}' })
      assert.equal(response.status, 403)
    }
    const response = await fetch(url, { method: 'POST', headers: { 'x-desktop-token': 'test-desktop-token' }, body: '{}' })
    assert.equal(response.status, 401, 'authorized desktop transport still requires forum account credentials')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
