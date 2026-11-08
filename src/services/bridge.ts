import type { MsTraderApi } from '@shared/api'
import { SYMBOLS, getInstrument } from '@shared/instruments'
import type { AppSettings, Candle, FeedState, PendingOrder, Position, Tick, TradeRecord } from '@shared/types'
import { DEFAULT_SETTINGS, TIMEFRAME_SECONDS } from '@shared/types'

declare global {
  interface Window {
    mstrader?: MsTraderApi
  }
}

/**
 * Returns the Electron preload bridge, or a browser-only shim when the
 * renderer is opened outside Electron (plain `vite` dev / component testing).
 * The shim persists to localStorage and runs an in-page simulated feed so the
 * whole UI remains exercisable without the main process.
 */
export function getBridge(): MsTraderApi {
  if (window.mstrader) return window.mstrader
  if (!shim) shim = createBrowserShim()
  return shim
}

export const isElectron = (): boolean => Boolean(window.mstrader)

let shim: MsTraderApi | null = null

function createBrowserShim(): MsTraderApi {
  const load = <T>(k: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(`mstrader:${k}`)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }
  const save = (k: string, v: unknown) => localStorage.setItem(`mstrader:${k}`, JSON.stringify(v))

  const ANCHORS: Record<string, number> = {
    EURUSD: 1.085, GBPUSD: 1.27, USDJPY: 151.2, AUDUSD: 0.655, USDCAD: 1.365, NZDUSD: 0.605,
    USDCHF: 0.885, XAUUSD: 2320, XAGUSD: 27.5, USOIL: 79.5, NG: 2.15,
  }
  const prices = new Map<string, number>(SYMBOLS.map((s) => [s, ANCHORS[s] ?? 1]))
  const tickListeners = new Set<(t: Tick[]) => void>()
  const stateListeners = new Set<(s: FeedState) => void>()
  let state: FeedState = { source: 'NONE', status: 'offline', lastTickAt: null }
  let timer: number | null = null

  const gaussian = () => {
    let u = 0, v = 0
    while (u === 0) u = Math.random()
    while (v === 0) v = Math.random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  const setState = (s: FeedState) => {
    state = s
    stateListeners.forEach((l) => l(s))
  }

  return {
    settings: {
      get: async () => ({ ...DEFAULT_SETTINGS, ...load<Partial<AppSettings>>('settings', {}) }),
      set: async (patch) => {
        const next = { ...DEFAULT_SETTINGS, ...load<Partial<AppSettings>>('settings', {}), ...patch }
        save('settings', next)
        return next
      },
    },
    account: {
      get: async () => load('account', { balance: 10_000, startingBalance: 10_000, positions: [] as Position[], orders: [] as PendingOrder[] }),
      set: async (s) => {
        const prev = load('account', { startingBalance: 10_000 })
        save('account', { ...prev, ...s })
        return true
      },
      reset: async (startingBalance) => {
        save('account', { balance: startingBalance, startingBalance, positions: [], orders: [] })
        save('trades', [])
        return true
      },
    },
    trades: {
      list: async (limit = 500) => load<TradeRecord[]>('trades', []).slice(0, limit),
      insert: async (t) => {
        save('trades', [t, ...load<TradeRecord[]>('trades', [])])
        return true
      },
    },
    feed: {
      start: async () => {
        if (timer) return state
        setState({ source: 'SIM', status: 'live', message: 'Browser simulated feed', lastTickAt: Date.now() })
        timer = window.setInterval(() => {
          const batch: Tick[] = []
          for (const s of SYMBOLS) {
            const inst = getInstrument(s)
            const p = prices.get(s)!
            const next = p + (ANCHORS[s] - p) * 0.0005 + gaussian() * inst.pipSize * 0.6
            prices.set(s, next)
            const half = (inst.typicalSpreadPips * inst.pipSize) / 2
            batch.push({ symbol: s, bid: next - half, ask: next + half, time: Date.now(), source: 'SIM' })
          }
          tickListeners.forEach((l) => l(batch))
        }, 400)
        return state
      },
      stop: async () => {
        if (timer) clearInterval(timer)
        timer = null
        setState({ source: 'NONE', status: 'offline', lastTickAt: null })
        return true
      },
      state: async () => state,
      history: async ({ symbol, timeframe, count }) => {
        const inst = getInstrument(symbol)
        const step = TIMEFRAME_SECONDS[timeframe]
        const now = Math.floor(Date.now() / 1000 / step) * step
        const out: Candle[] = []
        let price = prices.get(symbol)!
        const vol = inst.pipSize * Math.sqrt(step / 60) * 3
        for (let i = 0; i < count; i++) {
          const close = price
          const open = close - gaussian() * vol
          out.unshift({
            time: now - i * step,
            open,
            high: Math.max(open, close) + Math.abs(gaussian()) * vol * 0.5,
            low: Math.min(open, close) - Math.abs(gaussian()) * vol * 0.5,
            close,
            volume: Math.round(200 + Math.random() * 800),
          })
          price = open
        }
        return out
      },
      onTick: (cb) => {
        tickListeners.add(cb)
        return () => tickListeners.delete(cb)
      },
      onState: (cb) => {
        stateListeners.add(cb)
        return () => stateListeners.delete(cb)
      },
    },
    notify: async ({ title, body }) => {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body })
      return true
    },
    window: { minimize: () => {}, maximize: () => {}, close: () => {} },
    platform: 'browser',
  }
}
