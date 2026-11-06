import { existsSync } from 'node:fs'
import { needsX11Fallback } from './linux-compat.mjs'
import { app, BrowserWindow, Menu, dialog, net, protocol, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startProxy } from '../proxy/server.mjs'
import { bundlePath, externalUrl, isAppUrl } from './paths.mjs'

if (needsX11Fallback({ platform: process.platform, hasDri: existsSync('/dev/dri'), display: process.env.DISPLAY, explicitOzone: app.commandLine.hasSwitch('ozone-platform') })) {
  app.commandLine.appendSwitch('ozone-platform', 'x11')
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'trae', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

let mainWindow
let proxy
const smoke = process.argv.includes('--smoke-test')
const openExternal = (value) => {
  const url = externalUrl(value)
  if (url) void shell.openExternal(url).catch((error) => console.error('打开外部链接失败:', error.message))
}

async function initialize() {
  // Use a stable secure origin for localStorage, with a token-protected ephemeral API listener.
  const token = randomBytes(32).toString('hex')
  proxy = startProxy(0, { accessToken: token })
  await once(proxy, 'listening')
  const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`
  const root = path.join(app.getAppPath(), 'dist')
  protocol.handle('trae', async (request) => {
    if (!isAppUrl(request.url)) return new Response('Not found', { status: 404 })
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers)
      headers.delete('host')
      headers.set('x-desktop-token', token)
      try {
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
        if (body && body.byteLength > 20 * 1024 * 1024) return new Response('File too large', { status: 413 })
        return await fetch(`${proxyOrigin}${url.pathname}${url.search}`, {
          method: request.method, headers, body, signal: request.signal,
        })
      } catch {
        return Response.json({ error: '本地服务连接失败，请重启应用' }, { status: 502 })
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 })
    const file = bundlePath(root, url.pathname)
    if (!file) return new Response('Forbidden', { status: 403 })
    try { return await net.fetch(pathToFileURL(file).href) }
    catch { return new Response('Not found', { status: 404 }) }
  })
  createWindow()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 800, minHeight: 600,
    title: 'TRAE社区', backgroundColor: '#f6f7f9', show: false,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#737b89', height: 40 } } : { trafficLightPosition: { x: 16, y: 14 } }),
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: path.join(app.getAppPath(), 'build/icon.png') } : {}),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) { event.preventDefault(); openExternal(url) }
  })
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === mainWindow?.webContents && isAppUrl(contents.getURL()) && permission === 'clipboard-sanitized-write')
  })
  const window = mainWindow
  const showWindow = () => { if (!smoke && !window.isDestroyed() && !window.isVisible()) window.show() }
  const showTimer = smoke ? null : setTimeout(showWindow, 4000)
  window.once('ready-to-show', () => { clearTimeout(showTimer); showWindow() })
  window.on('closed', () => { clearTimeout(showTimer); if (mainWindow === window) mainWindow = null })
  if (smoke) {
    const timer = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1) }, 30_000)
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          localStorage.setItem('desktop-smoke', 'ok'); const stored = localStorage.getItem('desktop-smoke'); localStorage.removeItem('desktop-smoke');
          const response = await fetch('/api/posts.json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
          return { app: Boolean(document.querySelector('#root')?.children.length), stored, status: response.status, node: typeof window.require, emojiFont: (await document.fonts.load('16px \"TRAE Emoji\"', '📢🎉🫧')).length > 0 };
        })()`)
        if (!result.app || result.stored !== 'ok' || result.status !== 401 || result.node !== 'undefined' || !result.emojiFont) throw new Error(JSON.stringify(result))
        console.log('DESKTOP_SMOKE_OK', JSON.stringify(result))
        clearTimeout(timer); app.exit(0)
      } catch (error) { console.error(error); clearTimeout(timer); app.exit(1) }
    })
  }
  void mainWindow.loadURL('trae://app/').catch((error) => { console.error(error); app.exit(1) })
}

// Set the test profile before taking the per-profile single-instance lock.
if (smoke && process.env.TRAE_SMOKE_USER_DATA) app.setPath('userData', process.env.TRAE_SMOKE_USER_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() } })
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '视图', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    ]))
    await initialize()
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  }).catch((error) => { dialog.showErrorBox('TRAE社区启动失败', error.message); app.exit(1) })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => { proxy?.closeAllConnections(); proxy?.close() })
}
