import type { Candle } from '@shared/types'

export interface LinePoint {
  time: number
  value: number
}

/** Simple Moving Average */
export function sma(candles: Candle[], period: number): LinePoint[] {
  const out: LinePoint[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period })
  }
  return out
}

/** Exponential Moving Average (seeded with SMA of the first `period` bars) */
export function ema(candles: Candle[], period: number): LinePoint[] {
  const out: LinePoint[] = []
  if (candles.length < period) return out
  const k = 2 / (period + 1)
  let prev = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period
  out.push({ time: candles[period - 1].time, value: prev })
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k)
    out.push({ time: candles[i].time, value: prev })
  }
  return out
}

/** Wilder's RSI */
export function rsi(candles: Candle[], period = 14): LinePoint[] {
  const out: LinePoint[] = []
  if (candles.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  out.push({ time: candles[period].time, value: rsiValue(gain, loss) })
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out.push({ time: candles[i].time, value: rsiValue(gain, loss) })
  }
  return out
}

function rsiValue(gain: number, loss: number): number {
  if (loss === 0) return 100
  const rs = gain / loss
  return 100 - 100 / (1 + rs)
}

export type IndicatorKind = 'SMA' | 'EMA' | 'RSI'

export interface IndicatorConfig {
  id: string
  kind: IndicatorKind
  period: number
  color: string
  enabled: boolean
}

export const DEFAULT_INDICATORS: IndicatorConfig[] = [
  { id: 'sma20', kind: 'SMA', period: 20, color: '#fbbf24', enabled: false },
  { id: 'sma50', kind: 'SMA', period: 50, color: '#38bdf8', enabled: false },
  { id: 'ema9', kind: 'EMA', period: 9, color: '#c084fc', enabled: false },
  { id: 'ema21', kind: 'EMA', period: 21, color: '#f472b6', enabled: false },
  { id: 'rsi14', kind: 'RSI', period: 14, color: '#a78bfa', enabled: false },
]

export function computeIndicator(kind: IndicatorKind, candles: Candle[], period: number): LinePoint[] {
  switch (kind) {
    case 'SMA':
      return sma(candles, period)
    case 'EMA':
      return ema(candles, period)
    case 'RSI':
      return rsi(candles, period)
  }
}
