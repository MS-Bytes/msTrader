import { useCallback, useEffect, useRef, useState } from 'react'
import type { Candle, Tick, Timeframe } from '@shared/types'
import { TIMEFRAME_SECONDS } from '@shared/types'
import { getBridge } from '../services/bridge'
import { useMarketStore } from '../store/marketStore'
import { useTradeStore } from '../store/tradeStore'

/** Seconds of silence after which the feed is flagged as stale. */
const STALE_AFTER_MS = 30_000

/**
 * Boots the market-data pipeline once at app level:
 *   main-process FeedManager (OANDA stream → Yahoo poll → SIM)
 *     ─IPC batch→ marketStore.applyTicks (quotes, sparklines)
 *                 tradeStore.onTicks     (P&L, SL/TP, pending orders, stop-out)
 *
 * Also watches for stalls and asks the main process to restart the feed.
 */
export function useMarketData(): void {
  const applyTicks = useMarketStore((s) => s.applyTicks)
  const setFeed = useMarketStore((s) => s.setFeed)
  const onTicks = useTradeStore((s) => s.onTicks)
  const restarting = useRef(false)

  useEffect(() => {
    const bridge = getBridge()
    let unsubTick = () => {}
    let unsubState = () => {}
    let cancelled = false

    const boot = async () => {
      unsubTick = bridge.feed.onTick((ticks: Tick[]) => {
        applyTicks(ticks)
        onTicks(ticks)
      })
      unsubState = bridge.feed.onState(setFeed)
      try {
        const state = await bridge.feed.start()
        if (!cancelled) setFeed(state)
      } catch (err) {
        if (!cancelled) setFeed({ source: 'NONE', status: 'offline', message: String(err), lastTickAt: null })
      }
    }
    void boot()

    // Stale watchdog: SIM/OANDA tick constantly; Yahoo may legitimately be quiet
    // over the weekend, so we only flag (not restart) when the source is OANDA.
    const watchdog = setInterval(async () => {
      const { feed } = useMarketStore.getState()
      if (feed.status !== 'live' || !feed.lastTickAt) return
      if (Date.now() - feed.lastTickAt < STALE_AFTER_MS) return
      const quiet = feed.source === 'YAHOO' ? 'No price change recently (market closed?)' : 'No ticks received recently'
      setFeed({ ...feed, status: 'degraded', message: quiet })
      if (feed.source === 'OANDA' && !restarting.current) {
        restarting.current = true
        try {
          await bridge.feed.start()
        } finally {
          restarting.current = false
        }
      }
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(watchdog)
      unsubTick()
      unsubState()
    }
  }, [applyTicks, onTicks, setFeed])
}

interface CandleState {
  candles: Candle[]
  loading: boolean
  error: string | null
}

/**
 * Candle series for one symbol/timeframe. Loads history from the active feed
 * then aggregates live ticks into the last bar (or opens a new one when the
 * bucket rolls over). Returns a stable array reference plus a `version`
 * counter so the chart can apply incremental updates instead of re-setting
 * the whole series.
 */
export function useCandles(symbol: string, timeframe: Timeframe, count = 500): CandleState & { lastUpdate: Candle | null; version: number } {
  const [state, setState] = useState<CandleState>({ candles: [], loading: true, error: null })
  const [lastUpdate, setLastUpdate] = useState<Candle | null>(null)
  const [version, setVersion] = useState(0)
  const candlesRef = useRef<Candle[]>([])
  const setSessionOpen = useMarketStore((s) => s.setSessionOpen)
  // Reload when the feed fails over (e.g. Yahoo → SIM) so candles match the live source.
  const feedSource = useMarketStore((s) => s.feed.source)

  const load = useCallback(async () => {
    setState({ candles: [], loading: true, error: null })
    try {
      const data = await getBridge().feed.history({ symbol, timeframe, count })
      const sorted = data.filter((c) => Number.isFinite(c.close)).sort((a, b) => a.time - b.time)
      candlesRef.current = sorted
      setState({ candles: sorted, loading: false, error: sorted.length ? null : 'No history available' })
      setVersion((v) => v + 1)
      // Daily % change reference = open of the most recent daily bucket.
      const dayStart = Math.floor(Date.now() / 1000 / 86400) * 86400
      const first = sorted.find((c) => c.time >= dayStart) ?? sorted[sorted.length - 1]
      if (first) setSessionOpen(symbol, first.open)
    } catch (err) {
      candlesRef.current = []
      setState({ candles: [], loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  }, [symbol, timeframe, count, setSessionOpen])

  useEffect(() => {
    if (feedSource === 'NONE') return
    void load()
  }, [load, feedSource])

  // Subscribe to the quote for this symbol and roll it into the candle series.
  useEffect(() => {
    const step = TIMEFRAME_SECONDS[timeframe]
    const unsub = useMarketStore.subscribe((s, prev) => {
      const q = s.quotes[symbol]
      if (!q || q === prev.quotes[symbol]) return
      const arr = candlesRef.current
      if (!arr.length) return
      const bucket = Math.floor(q.time / 1000 / step) * step
      const last = arr[arr.length - 1]
      let updated: Candle
      if (bucket > last.time) {
        updated = { time: bucket, open: q.mid, high: q.mid, low: q.mid, close: q.mid, volume: 1 }
        arr.push(updated)
      } else {
        // Ignore ticks older than the current bar (clock skew / out-of-order)
        if (bucket < last.time) return
        updated = {
          ...last,
          high: Math.max(last.high, q.mid),
          low: Math.min(last.low, q.mid),
          close: q.mid,
          volume: last.volume + 1,
        }
        arr[arr.length - 1] = updated
      }
      setLastUpdate(updated)
    })
    return unsub
  }, [symbol, timeframe])

  return { ...state, candles: candlesRef.current, lastUpdate, version }
}
