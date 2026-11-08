import { getInstrument } from '@shared/instruments'
import type { Candle, HistoryRequest, Timeframe } from '@shared/types'
import { TIMEFRAME_SECONDS } from '@shared/types'
import { BaseFeed, fetchWithTimeout } from './base'

/**
 * Yahoo Finance fallback. Polls the public v8 chart endpoint (no key needed)
 * per symbol in a staggered round-robin so we never burst the rate limiter.
 *
 * Runs in the Electron main process, which acts as the "local proxy": the
 * renderer never talks to Yahoo directly (avoids CORS and keeps the UA stable).
 */
export class YahooFeed extends BaseFeed {
  readonly source = 'YAHOO' as const
  private symbols: string[] = []
  private timer: NodeJS.Timeout | null = null
  private cursor = 0
  private consecutiveFailures = 0
  private lastPrices = new Map<string, number>()
  /** Fires after N consecutive failures so the manager can fail over. */
  public onFatal: ((reason: string) => void) | null = null

  constructor(private readonly intervalMs: number) {
    super()
  }

  async start(symbols: string[]): Promise<void> {
    this.symbols = symbols
    this.setState({ status: 'connecting', message: 'Polling Yahoo Finance…' })
    // Probe one symbol so start() rejects fast if Yahoo is unreachable.
    await this.pollSymbol(symbols[0])
    this.setState({ status: 'live', message: 'Yahoo Finance polling (delayed ~15s)' })
    // Stagger: each tick of the timer polls one symbol, cycling through the list.
    const perSymbol = Math.max(250, Math.floor(this.intervalMs / Math.max(1, symbols.length)))
    this.timer = setInterval(() => void this.pollNext(), perSymbol)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.setState({ status: 'offline', message: 'Stopped' })
  }

  private async pollNext(): Promise<void> {
    if (!this.symbols.length) return
    const symbol = this.symbols[this.cursor % this.symbols.length]
    this.cursor++
    try {
      await this.pollSymbol(symbol)
      if (this.consecutiveFailures > 0) {
        this.consecutiveFailures = 0
        this.setState({ status: 'live', message: 'Yahoo Finance polling (delayed ~15s)' })
      }
    } catch (err) {
      this.consecutiveFailures++
      const msg = err instanceof Error ? err.message : String(err)
      this.setState({ status: 'degraded', message: `Yahoo error: ${msg}` })
      if (this.consecutiveFailures >= this.symbols.length * 2) {
        this.onFatal?.(msg)
      }
    }
  }

  private async pollSymbol(symbol: string): Promise<void> {
    const inst = getInstrument(symbol)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.providers.yahoo)}?interval=1m&range=1d&includePrePost=false`
    const res = await fetchWithTimeout(url, { headers: YAHOO_HEADERS }, 8000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as YahooChartResponse
    const result = json.chart?.result?.[0]
    if (!result) throw new Error(json.chart?.error?.description ?? 'Empty response')
    const meta = result.meta
    const price = meta.regularMarketPrice
    if (!Number.isFinite(price)) throw new Error('No price')

    // Yahoo rarely supplies bid/ask for FX; synthesize a realistic spread.
    const halfSpread = (inst.typicalSpreadPips * inst.pipSize) / 2
    const bid = meta.bid && meta.bid > 0 ? meta.bid : price - halfSpread
    const ask = meta.ask && meta.ask > 0 ? meta.ask : price + halfSpread

    // Only emit when the price actually moved, so candle volume reflects real activity.
    if (this.lastPrices.get(symbol) === price) return
    this.lastPrices.set(symbol, price)
    this.emitTick({ symbol, bid, ask, time: (meta.regularMarketTime ?? Date.now() / 1000) * 1000, source: 'YAHOO' })
  }

  async history(req: HistoryRequest): Promise<Candle[]> {
    const inst = getInstrument(req.symbol)
    // Yahoo has no 4h bars: fetch 1h and aggregate locally.
    const fetchTf: Timeframe = req.timeframe === '4h' ? '1h' : req.timeframe
    const { interval, range } = yahooRange(fetchTf, req.count)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.providers.yahoo)}?interval=${interval}&range=${range}`
    const res = await fetchWithTimeout(url, { headers: YAHOO_HEADERS })
    if (!res.ok) throw new Error(`Yahoo history HTTP ${res.status}`)
    const json = (await res.json()) as YahooChartResponse
    const result = json.chart?.result?.[0]
    if (!result?.timestamp) return []
    const q = result.indicators.quote[0]
    const candles: Candle[] = []
    for (let i = 0; i < result.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]
      if (o == null || h == null || l == null || c == null) continue
      candles.push({ time: result.timestamp[i], open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 })
    }
    return req.timeframe === '4h' ? aggregate(candles, TIMEFRAME_SECONDS['4h']) : candles.slice(-req.count)
  }
}

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
}

function yahooRange(tf: Timeframe, count: number): { interval: string; range: string } {
  switch (tf) {
    case '1m':
      return { interval: '1m', range: count > 390 ? '5d' : '1d' }
    case '5m':
      return { interval: '5m', range: '5d' }
    case '15m':
      return { interval: '15m', range: '1mo' }
    case '1h':
      return { interval: '1h', range: '3mo' }
    case '1d':
      return { interval: '1d', range: '2y' }
    default:
      return { interval: '1h', range: '3mo' }
  }
}

/** Bucket lower-timeframe candles into `bucketSec` bars. */
export function aggregate(candles: Candle[], bucketSec: number): Candle[] {
  const out: Candle[] = []
  for (const c of candles) {
    const t = Math.floor(c.time / bucketSec) * bucketSec
    const last = out[out.length - 1]
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
      last.volume += c.volume
    } else {
      out.push({ ...c, time: t })
    }
  }
  return out
}

interface YahooChartResponse {
  chart: {
    result?: {
      meta: { regularMarketPrice: number; regularMarketTime?: number; bid?: number; ask?: number }
      timestamp?: number[]
      indicators: {
        quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[]
      }
    }[]
    error?: { description: string } | null
  }
}
