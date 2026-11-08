import { getInstrument } from '@shared/instruments'
import type { Candle, HistoryRequest } from '@shared/types'
import { TIMEFRAME_SECONDS } from '@shared/types'
import { BaseFeed } from './base'

/** Reasonable anchor prices so the simulator starts near real market levels. */
const ANCHORS: Record<string, number> = {
  EURUSD: 1.085,
  GBPUSD: 1.27,
  USDJPY: 151.2,
  AUDUSD: 0.655,
  USDCAD: 1.365,
  NZDUSD: 0.605,
  USDCHF: 0.885,
  XAUUSD: 2320,
  XAGUSD: 27.5,
  USOIL: 79.5,
  NG: 2.15,
}

/**
 * Last-resort synthetic feed (geometric random walk with mild mean reversion).
 * Clearly labelled "SIM" in the UI so the user never mistakes it for live data.
 */
export class SimFeed extends BaseFeed {
  readonly source = 'SIM' as const
  private prices = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null

  /** Seed with last known real prices if a previous feed delivered any. */
  seed(prices: Map<string, number>): void {
    for (const [k, v] of prices) this.prices.set(k, v)
  }

  async start(symbols: string[]): Promise<void> {
    for (const s of symbols) if (!this.prices.has(s)) this.prices.set(s, ANCHORS[s] ?? 1)
    this.setState({ status: 'live', message: 'Simulated feed (no network source available)' })
    this.timer = setInterval(() => {
      for (const s of symbols) this.step(s)
    }, 400)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.setState({ status: 'offline' })
  }

  private step(symbol: string): void {
    const inst = getInstrument(symbol)
    const p = this.prices.get(symbol)!
    const anchor = ANCHORS[symbol] ?? p
    // ~0.5 pip std-dev per 400ms step, mean-reverting to anchor over time.
    const vol = inst.pipSize * 0.6
    const drift = (anchor - p) * 0.0005
    const next = p + drift + gaussian() * vol
    this.prices.set(symbol, next)
    const half = (inst.typicalSpreadPips * inst.pipSize) / 2
    this.emitTick({ symbol, bid: next - half, ask: next + half, time: Date.now(), source: 'SIM' })
  }

  async history(req: HistoryRequest): Promise<Candle[]> {
    const inst = getInstrument(req.symbol)
    const step = TIMEFRAME_SECONDS[req.timeframe]
    const now = Math.floor(Date.now() / 1000 / step) * step
    const candles: Candle[] = []
    let price = this.prices.get(req.symbol) ?? ANCHORS[req.symbol] ?? 1
    const volPerBar = inst.pipSize * Math.sqrt(step / 60) * 3
    // Build backwards from current price so the last bar joins the live ticks.
    for (let i = 0; i < req.count; i++) {
      const close = price
      const open = close - gaussian() * volPerBar
      const high = Math.max(open, close) + Math.abs(gaussian()) * volPerBar * 0.5
      const low = Math.min(open, close) - Math.abs(gaussian()) * volPerBar * 0.5
      candles.unshift({ time: now - i * step, open, high, low, close, volume: Math.round(200 + Math.random() * 800) })
      price = open
    }
    return candles
  }
}

function gaussian(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
