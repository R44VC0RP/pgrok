/**
 * Connection statistics tracker — rolling window of request timings.
 */

export interface ConnectionStats {
  totalRequests: number
  openConnections: number
  rate1m: number // requests per second over last 1 minute
  rate5m: number // requests per second over last 5 minutes
  p50Ms: number // 50th percentile response time in ms
  p90Ms: number // 90th percentile response time in ms
}

interface TimingEntry {
  ts: number
  ms: number
}

export class StatsTracker {
  private durations: TimingEntry[] = []
  private inFlight = 0
  private total = 0

  /** Record a completed request with its duration. */
  recordRequest(durationMs: number): void {
    this.total++
    this.durations.push({ ts: Date.now(), ms: durationMs })
    this.prune()
  }

  /** Mark a request as in-flight. Returns a function to call when it completes. */
  requestStart(): () => void {
    this.inFlight++
    return () => {
      this.inFlight = Math.max(0, this.inFlight - 1)
    }
  }

  /** Get current stats snapshot. */
  get(): ConnectionStats {
    this.prune()
    const now = Date.now()
    const last1m = this.durations.filter((d) => d.ts > now - 60_000)
    const last5m = this.durations

    const sorted = [...this.durations].sort((a, b) => a.ms - b.ms)
    const p50 =
      sorted.length > 0
        ? sorted[Math.floor(sorted.length * 0.5)].ms
        : 0
    const p90 =
      sorted.length > 0
        ? sorted[Math.floor(sorted.length * 0.9)].ms
        : 0

    return {
      totalRequests: this.total,
      openConnections: this.inFlight,
      rate1m: last1m.length > 0 ? last1m.length / 60 : 0,
      rate5m: last5m.length > 0 ? last5m.length / 300 : 0,
      p50Ms: Math.round(p50 * 100) / 100,
      p90Ms: Math.round(p90 * 100) / 100,
    }
  }

  /** Remove entries older than 5 minutes. */
  private prune(): void {
    const cutoff = Date.now() - 5 * 60 * 1000
    this.durations = this.durations.filter((d) => d.ts > cutoff)
  }
}
