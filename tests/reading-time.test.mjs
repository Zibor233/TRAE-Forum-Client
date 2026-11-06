import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

const compiled = ts.transpileModule(await fs.readFile(new URL('../src/lib/readingTime.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const { ReadingTime } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('reading counts one visible post per tick and drains deltas exactly once', () => {
  const clock = new ReadingTime(0)
  clock.tick(1000, 1, true)
  clock.tick(2000, 2, true)
  assert.deepEqual(clock.drain(), { topic_time: 2000, timings: { 1: 1000, 2: 1000 } })
  assert.equal(clock.drain(), null)
  clock.tick(3000, 2, true)
  assert.deepEqual(clock.drain(), { topic_time: 1000, timings: { 2: 1000 } })
})

test('hidden, idle, obscured and suspended intervals never become reading time', () => {
  const clock = new ReadingTime(0)
  clock.tick(1000, 1, false)
  clock.tick(2000, null, true)
  clock.tick(120_000, 1, true)
  clock.reset(180_000)
  clock.tick(181_000, 1, true)
  clock.tick(182_000, -1, true)
  assert.deepEqual(clock.drain(), { topic_time: 1000, timings: { 1: 1000 } })
})

test('a blocked upload cannot accumulate a batch above the server 60-second limit', () => {
  const clock = new ReadingTime(0)
  for (let i = 1; i <= 120; i++) clock.tick(i * 1000, i % 2 + 1, true)
  const batch = clock.drain()
  assert.equal(batch.topic_time, 60_000)
  assert.equal(Object.values(batch.timings).reduce((sum, duration) => sum + duration, 0), 60_000)
})
