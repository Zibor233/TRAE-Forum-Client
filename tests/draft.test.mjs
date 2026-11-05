import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

test('draft survives reopening, stays account-scoped, validates stored data and clears after publish', async () => {
  const original = globalThis.localStorage
  const data = new Map()
  globalThis.localStorage = {
    getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key),
  }
  try {
    const source = await fs.readFile(new URL('../src/lib/draft.ts', import.meta.url), 'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
    const drafts = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
    const draft = { title: '草稿', raw: '![图片](https://example.com/image.png)', categoryId: 5, tags: ['测试'] }
    assert.equal(drafts.saveDraft('alice', draft), true)
    assert.deepEqual(drafts.readDraft('alice'), draft)
    assert.equal(drafts.readDraft('bob'), null)
    drafts.clearDraft('alice')
    assert.equal(drafts.readDraft('alice'), null)
    drafts.saveDraft('alice', { title: '', raw: '', categoryId: 5, tags: [] })
    assert.equal(drafts.readDraft('alice'), null)
    data.set('trae-lite.topic-draft.v1:alice', '{broken')
    assert.equal(drafts.readDraft('alice'), null)
    data.set('trae-lite.topic-draft.v1:alice', JSON.stringify({ ...draft, tags: [123] }))
    assert.equal(drafts.readDraft('alice'), null)
    globalThis.localStorage.setItem = () => { throw new Error('quota') }
    assert.equal(drafts.saveDraft('alice', draft), false)
  } finally { globalThis.localStorage = original }
})
