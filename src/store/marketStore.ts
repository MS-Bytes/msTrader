import { create } from 'zustand'
import { SYMBOLS } from '@shared/instruments'
import type { FeedState, Tick, Timeframe } from '@shared/types'

export interface Quote extends Tick {
  mid: number
  /** Previous mid, for up/down flash */
  prevMid: number
  /** Session open mid (first tick seen or first history bar), for % change */
  sessionOpen: number
  changePct: number
  /** Last ~60 mids, for sparklines */
  sparkline: number[]
}

interface MarketState {
  quotes: Record<string, Quote>
  feed: FeedState
  selectedSymbol: string
  timeframe: Timeframe
  applyTicks(ticks: Tick[]): void
  setFeed(state: FeedState): void
  setSessionOpen(symbol: string, price: number): void
  selectSymbol(symbol: string): void
  setTimeframe(tf: Timeframe): void
}

const SPARK_LEN = 60

/**
 * Hot path: called up to 60×/s. We mutate a fresh `quotes` object only for
 * symbols that changed and keep untouched Quote references stable so
 * selectors on other rows don't re-render.
 */
export const useMarketStore = create<MarketState>((set, get) => ({
  quotes: {},
  feed: { source: 'NONE', status: 'connecting', lastTickAt: null },
  selectedSymbol: SYMBOLS[0],
  timeframe: '1m',

  applyTicks(ticks) {
    if (!ticks.length) return
    const prev = get().quotes
    const next = { ...prev }
    for (const t of ticks) {
      const mid = (t.bid + t.ask) / 2
      const old = prev[t.symbol]
      const sessionOpen = old?.sessionOpen ?? mid
      const spark = old ? old.sparkline.length >= SPARK_LEN ? [...old.sparkline.slice(1), mid] : [...old.sparkline, mid] : [mid]
      next[t.symbol] = {
        ...t,
        mid,
        prevMid: old?.mid ?? mid,
        sessionOpen,
        changePct: sessionOpen ? ((mid - sessionOpen) / sessionOpen) * 100 : 0,
        sparkline: spark,
      }
    }
    set({ quotes: next, feed: { ...get().feed, lastTickAt: ticks[ticks.length - 1].time } })
  },

  setFeed(feed) {
    set({ feed: { ...feed, lastTickAt: feed.lastTickAt ?? get().feed.lastTickAt } })
  },

  setSessionOpen(symbol, price) {
    const q = get().quotes[symbol]
    if (!q) return
    set({ quotes: { ...get().quotes, [symbol]: { ...q, sessionOpen: price, changePct: ((q.mid - price) / price) * 100 } } })
  },

  selectSymbol(symbol) {
    set({ selectedSymbol: symbol })
  },

  setTimeframe(tf) {
    set({ timeframe: tf })
  },
}))

export const selectQuote = (symbol: string) => (s: MarketState) => s.quotes[symbol]
