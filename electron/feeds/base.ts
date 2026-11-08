import type { Candle, FeedSource, FeedState, HistoryRequest, Tick } from '@shared/types'

export type TickListener = (tick: Tick) => void
export type StateListener = (state: FeedState) => void

/**
 * Common contract for every price source. Feeds push ticks via `onTick` and
 * report health via `onState`; the FeedManager handles failover between them.
 */
export interface PriceFeed {
  readonly source: FeedSource
  start(symbols: string[]): Promise<void>
  stop(): void
  history(req: HistoryRequest): Promise<Candle[]>
  onTick(listener: TickListener): void
  onState(listener: StateListener): void
  getState(): FeedState
}

export abstract class BaseFeed implements PriceFeed {
  abstract readonly source: FeedSource
  protected tickListeners: TickListener[] = []
  protected stateListeners: StateListener[] = []
  protected state: FeedState = { source: 'NONE', status: 'offline', lastTickAt: null }

  abstract start(symbols: string[]): Promise<void>
  abstract stop(): void
  abstract history(req: HistoryRequest): Promise<Candle[]>

  onTick(listener: TickListener): void {
    this.tickListeners.push(listener)
  }

  onState(listener: StateListener): void {
    this.stateListeners.push(listener)
  }

  protected emitTick(tick: Tick): void {
    this.state.lastTickAt = tick.time
    for (const l of this.tickListeners) l(tick)
  }

  protected setState(patch: Partial<FeedState>): void {
    this.state = { ...this.state, source: this.source, ...patch }
    for (const l of this.stateListeners) l(this.state)
  }

  getState(): FeedState {
    return this.state
  }
}

/** Fetch with timeout; Node 18+ global fetch. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}
