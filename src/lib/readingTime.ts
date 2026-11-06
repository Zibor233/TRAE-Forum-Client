/** Discourse timings are milliseconds, with a 60-second maximum per batch. */
export class ReadingTime {
  private last: number
  private total = 0
  private timings: Record<number, number> = {}

  constructor(now: number) { this.last = now }

  reset(now: number) { this.last = now }

  tick(now: number, postNumber: number | null, eligible: boolean) {
    const elapsed = now - this.last
    this.last = now
    // Sleeping/suspended renderers must not turn a delayed timer into reading time.
    if (!eligible || !postNumber || !Number.isInteger(postNumber) || postNumber < 1 || elapsed <= 0 || elapsed > 2000) return
    const duration = Math.min(Math.floor(elapsed), 60_000 - this.total)
    if (duration <= 0) return
    this.total += duration
    this.timings[postNumber] = (this.timings[postNumber] || 0) + duration
  }

  drain() {
    if (this.total < 1000) return null
    const batch = { topic_time: this.total, timings: this.timings }
    this.total = 0
    this.timings = {}
    return batch
  }
}
