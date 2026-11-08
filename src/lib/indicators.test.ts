import { describe, expect, it } from 'vitest'
import type { Candle } from '@shared/types'
import { ema, rsi, sma } from './indicators'

const bars = (closes: number[]): Candle[] => closes.map((c, i) => ({ time: i * 60, open: c, high: c, low: c, close: c, volume: 1 }))

describe('indicators', () => {
  it('SMA averages the trailing window', () => {
    const out = sma(bars([1, 2, 3, 4, 5]), 3)
    expect(out.map((p) => p.value)).toEqual([2, 3, 4])
    expect(out[0].time).toBe(120)
  })

  it('EMA seeds with SMA then smooths', () => {
    const out = ema(bars([1, 2, 3, 4, 5, 6]), 3)
    expect(out[0].value).toBe(2)
    // k = 0.5: 4*0.5 + 2*0.5 = 3; then 4; then 5
    expect(out.map((p) => p.value)).toEqual([2, 3, 4, 5])
  })

  it('RSI is 100 for a monotonic rise and ~0 for a monotonic fall', () => {
    const up = rsi(bars(Array.from({ length: 20 }, (_, i) => i)), 14)
    expect(up[up.length - 1].value).toBe(100)
    const down = rsi(bars(Array.from({ length: 20 }, (_, i) => 100 - i)), 14)
    expect(down[down.length - 1].value).toBe(0)
  })

  it('returns empty for insufficient data', () => {
    expect(rsi(bars([1, 2, 3]), 14)).toEqual([])
    expect(ema(bars([1, 2]), 3)).toEqual([])
  })
})
