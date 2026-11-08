import type { AppSettings, Candle, FeedState, HistoryRequest, Tick } from '@shared/types'
import type { PriceFeed, StateListener, TickListener } from './base'
import { OandaFeed } from './oanda'
import { SimFeed } from './sim'
import { YahooFeed } from './yahoo'

/**
 * Orchestrates price sources with automatic failover:
 *   OANDA stream (if credentials) -> Yahoo polling -> simulator (optional).
 * Every 60s it retries higher-priority sources so we climb back to live data
 * once connectivity is restored.
 */
export class FeedManager {
  private active: PriceFeed | null = null
  private symbols: string[] = []
  private settings: AppSettings
  private tickListeners: TickListener[] = []
  private stateListeners: StateListener[] = []
  private lastPrices = new Map<string, number>()
  private retryTimer: NodeJS.Timeout | null = null
  private state: FeedState = { source: 'NONE', status: 'offline', lastTickAt: null }
  private startPromise: Promise<FeedState> | null = null

  constructor(settings: AppSettings) {
    this.settings = settings
  }

  onTick(l: TickListener): void {
    this.tickListeners.push(l)
  }

  onState(l: StateListener): void {
    this.stateListeners.push(l)
  }

  getState(): FeedState {
    return this.state
  }

  updateSettings(settings: AppSettings): void {
    const credsChanged =
      settings.oandaApiKey !== this.settings.oandaApiKey ||
      settings.oandaAccountId !== this.settings.oandaAccountId ||
      settings.oandaEnv !== this.settings.oandaEnv ||
      settings.pollIntervalMs !== this.settings.pollIntervalMs ||
      settings.allowSimulatedFeed !== this.settings.allowSimulatedFeed
    this.settings = settings
    if (credsChanged && this.symbols.length) void this.start(this.symbols)
  }

  start(symbols: string[]): Promise<FeedState> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.runStart(symbols).finally(() => {
      this.startPromise = null
      this.scheduleRetry()
    })
    return this.startPromise
  }

  private async runStart(symbols: string[]): Promise<FeedState> {
    this.symbols = symbols
    this.stop(false)
    {
      for (const candidate of this.buildChain()) {
        try {
          await this.activate(candidate, symbols)
          return this.state
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.publishState({ source: candidate.source, status: 'degraded', message: `${candidate.source} unavailable: ${msg}` })
        }
      }
      this.publishState({ source: 'NONE', status: 'offline', message: 'No market data source available' })
      return this.state
    }
  }

  stop(clearRetry = true): void {
    this.active?.stop()
    this.active = null
    if (clearRetry && this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }
  }

  async history(req: HistoryRequest): Promise<Candle[]> {
    // The renderer may ask for candles while the failover chain is still resolving.
    if (!this.active && this.startPromise) await this.startPromise
    if (!this.active) throw new Error('Feed not started')
    return this.active.history(req)
  }

  private buildChain(): PriceFeed[] {
    const chain: PriceFeed[] = []
    const { oandaApiKey, oandaAccountId, oandaEnv, pollIntervalMs, allowSimulatedFeed } = this.settings
    if (oandaApiKey && oandaAccountId) chain.push(new OandaFeed({ apiKey: oandaApiKey, accountId: oandaAccountId, env: oandaEnv }))
    const yahoo = new YahooFeed(pollIntervalMs)
    yahoo.onFatal = () => void this.failoverFrom(yahoo)
    chain.push(yahoo)
    if (allowSimulatedFeed) {
      const sim = new SimFeed()
      sim.seed(this.lastPrices)
      chain.push(sim)
    }
    return chain
  }

  private async activate(feed: PriceFeed, symbols: string[]): Promise<void> {
    feed.onTick((t) => this.handleTick(t))
    feed.onState((s) => {
      if (this.active === feed) this.publishState(s)
    })
    await feed.start(symbols)
    this.active = feed
    // States emitted during start() were suppressed by the guard above; replay the final one.
    this.publishState(feed.getState())
  }

  private async failoverFrom(failed: PriceFeed): Promise<void> {
    if (this.active !== failed || this.startPromise) return
    const chain = this.buildChain()
    const idx = chain.findIndex((f) => f.source === failed.source)
    failed.stop()
    this.active = null
    for (const candidate of chain.slice(idx + 1)) {
      try {
        await this.activate(candidate, this.symbols)
        return
      } catch {
        /* try next */
      }
    }
    this.publishState({ source: 'NONE', status: 'offline', message: 'All data sources failed' })
  }

  /** Periodically try to climb back to a better source. */
  private scheduleRetry(): void {
    if (this.retryTimer) return
    this.retryTimer = setInterval(() => {
      const rank = { OANDA: 0, YAHOO: 1, SIM: 2, NONE: 3 } as const
      const best = this.buildChain()[0]?.source ?? 'NONE'
      if (this.active && rank[this.active.source] <= rank[best]) return
      void this.start(this.symbols)
    }, 60_000)
  }

  private handleTick(tick: Tick): void {
    this.lastPrices.set(tick.symbol, (tick.bid + tick.ask) / 2)
    for (const l of this.tickListeners) l(tick)
  }

  private publishState(s: Omit<FeedState, 'lastTickAt'> & { lastTickAt?: number | null }): void {
    this.state = { ...s, lastTickAt: s.lastTickAt ?? this.state.lastTickAt }
    for (const l of this.stateListeners) l(this.state)
  }
}
