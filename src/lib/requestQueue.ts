/**
 * 全局请求队列：最大并发 4，按优先级出队（同级 FIFO）；同一 key 的请求在 300ms 内合并。
 * 优先级：
 *  - user：点击触发的详情/搜索/分页/发送
 *  - normal：首屏列表等常规请求
 *  - prefetch：滚动预取、作者补全、置顶预取
 * prefetch 最多占用 3 个并发槽位，始终给 user 留出 1 个可抢占的位置。
 */

export type QueuePriority = 'user' | 'normal' | 'prefetch'

const MAX_CONCURRENCY = 4
const MAX_PREFETCH_ACTIVE = MAX_CONCURRENCY - 1
const DEDUPE_WINDOW_MS = 300
const MAX_SETTLED = 300

const PRIORITY_RANK: Record<QueuePriority, number> = {
  user: 0,
  normal: 1,
  prefetch: 2,
}

type Resolve<T> = (value: T) => void
type Reject = (reason: unknown) => void

interface Job {
  run: () => Promise<unknown>
  resolve: Resolve<unknown>
  reject: Reject
  priority: QueuePriority
  seq: number
}

const queue: Job[] = []

let active = 0
let activePrefetch = 0
let seq = 0

function canRun(job: Job): boolean {
  return job.priority !== 'prefetch' || activePrefetch < MAX_PREFETCH_ACTIVE
}

function takeNext(): Job | null {
  let bestIndex = -1
  for (let i = 0; i < queue.length; i += 1) {
    if (!canRun(queue[i])) continue
    if (bestIndex === -1 || PRIORITY_RANK[queue[i].priority] < PRIORITY_RANK[queue[bestIndex].priority]) {
      bestIndex = i
    }
  }
  return bestIndex === -1 ? null : queue.splice(bestIndex, 1)[0]
}

function pump() {
  while (active < MAX_CONCURRENCY && queue.length) {
    const job = takeNext()
    if (!job) return
    active += 1
    if (job.priority === 'prefetch') activePrefetch += 1
    let result: Promise<unknown>
    try {
      result = job.run()
    } catch (err) {
      result = Promise.reject(err)
    }
    result
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1
        if (job.priority === 'prefetch') activePrefetch -= 1
        pump()
      })
  }
}

/** 把任务放进全局队列；超出并发或优先级不够时等待 */
export function enqueue<T>(run: () => Promise<T>, priority: QueuePriority = 'normal'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    seq += 1
    queue.push({ run, resolve: resolve as Resolve<unknown>, reject, priority, seq })
    pump()
  })
}

const inflight = new Map<string, Promise<unknown>>()
const settled = new Map<string, { at: number; value: unknown }>()

/**
 * 同一 key：进行中的请求直接复用；成功结果在 300ms 内复用，避免重复拉取。
 * 这里只做合并、不再重复入队——入队由调用方负责，否则任务会占满并发槽位
 * 等待自己的内层任务，形成死锁。
 */
export function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const cached = settled.get(key)
  if (cached && now - cached.at < DEDUPE_WINDOW_MS) {
    return Promise.resolve(cached.value as T)
  }

  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const promise = Promise.resolve()
    .then(run)
    .then((value) => {
      inflight.delete(key)
      settled.set(key, { at: Date.now(), value })
      if (settled.size > MAX_SETTLED) {
        for (const [entryKey, entry] of settled) {
          if (Date.now() - entry.at >= DEDUPE_WINDOW_MS) settled.delete(entryKey)
        }
      }
      return value
    })
    .catch((error) => {
      inflight.delete(key)
      throw error
    })

  inflight.set(key, promise)
  return promise
}
