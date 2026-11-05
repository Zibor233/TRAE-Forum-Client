// 一条命令同时启动本地代理与 Vite（跨平台，无需 concurrently）
import { startProxy } from '../proxy/server.mjs'
import { createServer } from 'vite'

const proxy = startProxy()

const vite = await createServer()
await vite.listen()
vite.printUrls()

const shutdown = () => {
  vite.close().finally(() => proxy.close(() => process.exit(0)))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
