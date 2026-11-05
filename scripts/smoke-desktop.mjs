import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'

const temporary = await mkdtemp(path.join(os.tmpdir(), 'lightread-smoke-'))
const env = { ...process.env, TRAE_SMOKE_USER_DATA: temporary }
delete env.ELECTRON_RUN_AS_NODE
const binary = process.argv[2] || electron
const args = process.argv[2] ? ['--smoke-test'] : ['.', '--smoke-test']
const child = spawn(binary, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let passed = false
let output = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => {
  const text = data.toString()
  output += text
  if (output.includes('DESKTOP_SMOKE_OK')) passed = true
  process.stdout.write(text)
})
const timer = setTimeout(() => child.kill(), 45_000)
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('close', async (code) => {
  clearTimeout(timer)
  process.exitCode = code === 0 && passed ? 0 : 1
  const resolved = path.resolve(temporary)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('lightread-smoke-')) throw new Error('Unexpected smoke directory')
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})
