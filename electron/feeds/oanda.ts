import { getInstrument, fromProviderSymbol } from '@shared/instruments'
import type { Candle, HistoryRequest, Timeframe } from '@shared/types'
import { BaseFeed, fetchWithTimeout } from './base'

export interface OandaConfig {
  apiKey: string
  accountId: string
  env: 'practice' | 'live'
}

const GRANULARITY: Record<Timeframe, string> = {
  '1m': 'M1',
  '5m': 'M5',
  '15m': 'M15',
  '1h': 'H1',
  '4h': 'H4',
  '1d': 'D',
}

/**
 * OANDA v20 pricing stream.
 *
 * OANDA does not expose a WebSocket; its "stream" endpoint is a long-lived
 * HTTP/1.1 chunked response delivering newline-delimited JSON (PRICE and
 * HEARTBEAT messages). We consume it with the Fetch streaming API, which gives
 * identical tick-level latency to a socket. Reconnects use exponential backoff
 * and heartbeat watchdog so a silent stall is detected within ~15s.
 */
export class OandaFeed extends BaseFeed {
  readonly source = 'OANDA' as const
  private abort: AbortController | null = null
  private symbols: string[] = []
  private backoffMs = 1000
  private heartbeatTimer: NodeJS.Timeout | null = null
  private stopped = true

  constructor(private readonly cfg: OandaConfig) {
    super()
  }

  private get restHost(): string {
    return this.cfg.env === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com'
  }

  private get streamHost(): string {
    return this.cfg.env === 'live' ? 'https://stream-fxtrade.oanda.com' : 'https://stream-fxpractice.oanda.com'
  }

  private get headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.apiKey}`, 'Accept-Datetime-Format': 'UNIX' }
  }

  async start(symbols: string[]): Promise<void> {
    if (!this.cfg.apiKey || !this.cfg.accountId) throw new Error('OANDA credentials not configured')
    this.symbols = symbols
    this.stopped = false
    this.setState({ status: 'connecting', message: 'Connecting to OANDA stream…' })
    // Validate credentials up-front so the manager can fail over immediately.
    const probe = await fetchWithTimeout(`${this.restHost}/v3/accounts/${this.cfg.accountId}/summary`, {
      headers: this.headers,
    })
    if (!probe.ok) throw new Error(`OANDA auth failed (${probe.status})`)
    void this.connectLoop()
  }

  stop(): void {
    this.stopped = true
    this.abort?.abort()
    this.abort = null
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.setState({ status: 'offline', message: 'Stopped' })
  }

  private async connectLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.consumeStream()
        this.backoffMs = 1000
      } catch (err) {
        if (this.stopped) return
        const msg = err instanceof Error ? err.message : String(err)
        this.setState({ status: 'degraded', message: `Stream error: ${msg}. Reconnecting…` })
        await new Promise((r) => setTimeout(r, this.backoffMs))
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000)
      }
    }
  }

  private armHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    // OANDA sends HEARTBEAT every ~5s; 15s of silence means the connection is dead.
    this.heartbeatTimer = setTimeout(() => this.abort?.abort(), 15_000)
  }

  private async consumeStream(): Promise<void> {
    const instruments = this.symbols.map((s) => getInstrument(s).providers.oanda).join(',')
    const url = `${this.streamHost}/v3/accounts/${this.cfg.accountId}/pricing/stream?instruments=${encodeURIComponent(instruments)}`
    this.abort = new AbortController()
    const res = await fetch(url, { headers: this.headers, signal: this.abort.signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

    this.setState({ status: 'live', message: 'OANDA stream connected' })
    this.armHeartbeat()

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error('Stream closed by server')
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) this.handleLine(line)
      }
    }
  }

  private handleLine(line: string): void {
    let msg: OandaStreamMessage
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    this.armHeartbeat()
    if (msg.type !== 'PRICE' || !msg.instrument) return
    const symbol = fromProviderSymbol('oanda', msg.instrument)
    if (!symbol) return
    const bid = Number(msg.bids?.[0]?.price ?? msg.closeoutBid)
    const ask = Number(msg.asks?.[0]?.price ?? msg.closeoutAsk)
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return
    this.emitTick({ symbol, bid, ask, time: Number(msg.time) * 1000 || Date.now(), source: 'OANDA' })
  }

  async history(req: HistoryRequest): Promise<Candle[]> {
    const inst = getInstrument(req.symbol)
    const count = Math.min(Math.max(req.count, 1), 5000)
    const url = `${this.restHost}/v3/instruments/${inst.providers.oanda}/candles?granularity=${GRANULARITY[req.timeframe]}&count=${count}&price=M`
    const res = await fetchWithTimeout(url, { headers: this.headers })
    if (!res.ok) throw new Error(`OANDA candles HTTP ${res.status}`)
    const json = (await res.json()) as { candles: OandaCandle[] }
    return json.candles
      .filter((c) => c.complete || true)
      .map((c) => ({
        time: Math.floor(Number(c.time)),
        open: Number(c.mid.o),
        high: Number(c.mid.h),
        low: Number(c.mid.l),
        close: Number(c.mid.c),
        volume: c.volume,
      }))
  }
}

interface OandaStreamMessage {
  type: 'PRICE' | 'HEARTBEAT'
  time: string
  instrument?: string
  bids?: { price: string; liquidity: number }[]
  asks?: { price: string; liquidity: number }[]
  closeoutBid?: string
  closeoutAsk?: string
}

interface OandaCandle {
  time: string
  complete: boolean
  volume: number
  mid: { o: string; h: string; l: string; c: string }
}
