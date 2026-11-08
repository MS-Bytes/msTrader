import { describe, expect, it } from 'vitest'
import type { Tick } from '@shared/types'
import { calcPnl, commission, fillPrice, pipValueUsd, requiredMargin, simulateSlippage, spreadCost } from './pricing'

const tick = (symbol: string, bid: number, ask: number): Tick => ({ symbol, bid, ask, time: 0, source: 'SIM' })

describe('pricing', () => {
  it('computes P&L for USD-quoted pairs', () => {
    // 1 lot EURUSD, +10 pips = $100
    expect(calcPnl('EURUSD', 'BUY', 100_000, 1.1, 1.101)).toBeCloseTo(100, 6)
    expect(calcPnl('EURUSD', 'SELL', 100_000, 1.1, 1.101)).toBeCloseTo(-100, 6)
  })

  it('converts P&L for USD-based pairs via the exit rate', () => {
    // 1 lot USDJPY, +100 pips (1.00 JPY) at 151 = ¥100,000 / 151 ≈ $662.25
    expect(calcPnl('USDJPY', 'BUY', 100_000, 150, 151)).toBeCloseTo(662.25, 2)
  })

  it('computes gold P&L with 100oz contract', () => {
    // 1 lot XAUUSD, +$10 = $1,000
    expect(calcPnl('XAUUSD', 'BUY', 100, 2300, 2310)).toBeCloseTo(1000, 6)
  })

  it('computes margin from notional and leverage', () => {
    expect(requiredMargin('EURUSD', 1, 1.1)).toBeCloseTo(110_000 / 30, 6)
    expect(requiredMargin('USDJPY', 1, 151)).toBeCloseTo(100_000 / 30, 6)
    expect(requiredMargin('XAUUSD', 1, 2300)).toBeCloseTo(230_000 / 20, 6)
  })

  it('pip value is $10 per standard lot on USD-quoted majors', () => {
    expect(pipValueUsd('EURUSD', 1, 1.1)).toBeCloseTo(10, 6)
    expect(pipValueUsd('GBPUSD', 0.1, 1.27)).toBeCloseTo(1, 6)
  })

  it('charges commission per lot and spread cost in USD', () => {
    expect(commission('EURUSD', 0.5)).toBe(3.5)
    expect(commission('XAUUSD', 1)).toBe(0)
    expect(spreadCost('EURUSD', 1, tick('EURUSD', 1.1, 1.1001))).toBeCloseTo(10, 6)
  })

  it('slippage is bounded and mostly adverse', () => {
    const t = tick('EURUSD', 1.1, 1.10008)
    let adverse = 0
    const n = 2000
    for (let i = 0; i < n; i++) {
      const s = simulateSlippage('EURUSD', 'BUY', 0.1, t)
      expect(Math.abs(s)).toBeLessThanOrEqual(0.0001 * 0.6)
      if (s > 0) adverse++
      expect(fillPrice('BUY', t, s)).toBeCloseTo(t.ask + s, 10)
    }
    expect(adverse / n).toBeGreaterThan(0.7)
    expect(adverse / n).toBeLessThan(0.9)
  })

  it('large orders slip more', () => {
    const t = tick('EURUSD', 1.1, 1.10008)
    const avg = (lots: number) => {
      let s = 0
      for (let i = 0; i < 1000; i++) s += Math.abs(simulateSlippage('EURUSD', 'BUY', lots, t))
      return s / 1000
    }
    expect(avg(10)).toBeGreaterThan(avg(0.1) * 3)
  })
})
