import test from 'node:test'
import assert from 'node:assert/strict'
import { needsX11Fallback } from '../desktop/linux-compat.mjs'

test('Linux without DRM uses XWayland only when a display is available', () => {
  const machine = { platform: 'linux', hasDri: false, display: ':0', explicitOzone: false }
  assert.equal(needsX11Fallback(machine), true)
  assert.equal(needsX11Fallback({ ...machine, hasDri: true }), false)
  assert.equal(needsX11Fallback({ ...machine, display: undefined }), false)
  assert.equal(needsX11Fallback({ ...machine, explicitOzone: true }), false)
  for (const platform of ['win32', 'darwin']) assert.equal(needsX11Fallback({ ...machine, platform }), false)
})
