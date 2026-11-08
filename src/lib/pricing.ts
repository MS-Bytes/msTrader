import { getInstrument } from '@shared/instruments'
import type { Instrument, Side, Tick } from '@shared/types'

/**
 * Pricing & risk math for the paper-trading engine.
 * All money values are in account currency (USD).
 */

/** USD value of a 1-unit price move for `units` of the instrument, at a given price. */
export function pnlPerPriceUnit(inst: Instrument, units: number, price: number): number {
  // Quote currency is USD (EURUSD, XAUUSD, ...): P&L = Δprice × units.
  if (inst.quoteCurrency === 'USD') return units
  // Base currency is USD (USDJPY, USDCAD, ...): P&L accrues in the quote
  // currency, convert back at the current rate.
  if (inst.baseCurrency === 'USD') return units / price
  // Cross pairs would need a third rate; not in our instrument list.
  return units
}

export function calcPnl(symbol: string, side: Side, units: number, entry: number, exit: number): number {
  const inst = getInstrument(symbol)
  const diff = side === 'BUY' ? exit - entry : entry - exit
  return diff * pnlPerPriceUnit(inst, units, exit)
}

/** Notional value in USD of the position. */
export function notionalUsd(symbol: string, units: number, price: number): number {
  const inst = getInstrument(symbol)
  if (inst.quoteCurrency === 'USD') return units * price
  if (inst.baseCurrency === 'USD') return units
  return units * price
}

export function requiredMargin(symbol: string, lots: number, price: number): number {
  const inst = getInstrument(symbol)
  return notionalUsd(symbol, lots * inst.contractSize, price) / inst.leverage
}

export function commission(symbol: string, lots: number): number {
  return getInstrument(symbol).commissionPerLot * lots
}

/** Spread cost in USD when the position is opened (what you'd lose closing instantly). */
export function spreadCost(symbol: string, lots: number, tick: Tick): number {
  const inst = getInstrument(symbol)
  const units = lots * inst.contractSize
  return (tick.ask - tick.bid) * pnlPerPriceUnit(inst, units, tick.ask)
}

/**
 * Realistic slippage model: a random, size-dependent adverse price move.
 *  - Base: 0–0.3 pip of random noise (liquidity jitter)
 *  - Size impact: +0.1 pip per full lot above 1 lot (market impact)
 *  - Spread regime: widened spreads (>2× typical) double slippage (thin market)
 * Slippage is always adverse (worse fill) ~80% of the time, favourable ~20%.
 */
export function simulateSlippage(symbol: string, side: Side, lots: number, tick: Tick): number {
  const inst = getInstrument(symbol)
  const spreadPips = (tick.ask - tick.bid) / inst.pipSize
  const regime = spreadPips > inst.typicalSpreadPips * 2 ? 2 : 1
  const noise = Math.random() * 0.3
  const impact = Math.max(0, lots - 1) * 0.1
  const pips = (noise + impact) * regime
  const adverse = Math.random() < 0.8
  const signed = adverse ? pips : -pips * 0.5
  // BUY fills higher when adverse, SELL fills lower.
  return side === 'BUY' ? signed * inst.pipSize : -signed * inst.pipSize
}

export function fillPrice(side: Side, tick: Tick, slippage: number): number {
  const raw = side === 'BUY' ? tick.ask : tick.bid
  return raw + slippage
}

/** Mark price used to value an open position (what you'd close at). */
export function markPrice(side: Side, tick: Tick): number {
  return side === 'BUY' ? tick.bid : tick.ask
}

export function pipValueUsd(symbol: string, lots: number, price: number): number {
  const inst = getInstrument(symbol)
  return inst.pipSize * pnlPerPriceUnit(inst, lots * inst.contractSize, price)
}

export function roundToPrecision(symbol: string, price: number): number {
  const p = getInstrument(symbol).precision
  return Number(price.toFixed(p))
}
