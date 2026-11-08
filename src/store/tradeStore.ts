import { create } from 'zustand'
import { getInstrument } from '@shared/instruments'
import type { AccountSnapshot, CloseReason, PendingOrder, Position, Side, Tick, TradeRecord } from '@shared/types'
import { fmtMoney, fmtPrice } from '../lib/format'
import {
  calcPnl,
  commission,
  fillPrice,
  markPrice,
  requiredMargin,
  roundToPrecision,
  simulateSlippage,
  spreadCost,
} from '../lib/pricing'
import { sounds } from '../lib/sound'
import { getBridge } from '../services/bridge'
import { useMarketStore } from './marketStore'
import { useSettingsStore } from './settingsStore'
import { useUiStore } from './uiStore'

/** Margin level (%) at which open positions are force-liquidated. */
const STOP_OUT_LEVEL = 50

export interface OrderRequest {
  symbol: string
  side: Side
  lots: number
  stopLoss?: number | null
  takeProfit?: number | null
}

export interface PendingOrderRequest extends OrderRequest {
  type: 'LIMIT' | 'STOP'
  price: number
}

interface TradeState {
  balance: number
  startingBalance: number
  positions: Position[]
  orders: PendingOrder[]
  history: TradeRecord[]
  account: AccountSnapshot
  hydrated: boolean

  hydrate(): Promise<void>
  openMarket(req: OrderRequest): Position | null
  placeOrder(req: PendingOrderRequest): PendingOrder | null
  cancelOrder(id: string): void
  closePosition(id: string, reason?: CloseReason): void
  closeAll(): void
  modifyPosition(id: string, patch: { stopLoss?: number | null; takeProfit?: number | null }): void
  onTicks(ticks: Tick[]): void
  resetAccount(startingBalance: number): Promise<void>
}

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function snapshot(balance: number, positions: Position[]): AccountSnapshot {
  const unrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0)
  const marginUsed = positions.reduce((s, p) => s + p.margin, 0)
  const equity = balance + unrealizedPnl
  const freeMargin = equity - marginUsed
  const marginLevel = marginUsed > 0 ? (equity / marginUsed) * 100 : null
  return { balance, equity, marginUsed, freeMargin, marginLevel, unrealizedPnl }
}

// Persist at most every 500ms: ticks mutate positions constantly, but only
// balance/open sets matter for crash recovery.
let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(get: () => TradeState): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const { balance, positions, orders } = get()
    getBridge()
      .account.set({ balance, positions, orders })
      .catch((err) => console.error('Persist failed', err))
  }, 500)
}

function notify(kind: 'success' | 'error' | 'info' | 'warn', title: string, body: string, sound?: () => void): void {
  useUiStore.getState().pushToast(kind, title, body)
  if (useSettingsStore.getState().settings.soundAlerts) sound?.()
  void getBridge().notify({ title: `msTrader — ${title}`, body })
}

export const useTradeStore = create<TradeState>((set, get) => ({
  balance: 10_000,
  startingBalance: 10_000,
  positions: [],
  orders: [],
  history: [],
  account: snapshot(10_000, []),
  hydrated: false,

  async hydrate() {
    try {
      const bridge = getBridge()
      const [acct, history] = await Promise.all([bridge.account.get(), bridge.trades.list(500)])
      set({
        balance: acct.balance,
        startingBalance: acct.startingBalance,
        positions: acct.positions,
        orders: acct.orders,
        history,
        account: snapshot(acct.balance, acct.positions),
        hydrated: true,
      })
    } catch (err) {
      console.error('Failed to hydrate account', err)
      set({ hydrated: true })
    }
  },

  openMarket(req) {
    const tick = useMarketStore.getState().quotes[req.symbol]
    if (!tick) {
      notify('error', 'Order rejected', `No market price for ${req.symbol}`, sounds.error)
      return null
    }
    const err = validate(req)
    if (err) {
      notify('error', 'Order rejected', err, sounds.error)
      return null
    }
    const inst = getInstrument(req.symbol)
    const units = req.lots * inst.contractSize
    const slippage = simulateSlippage(req.symbol, req.side, req.lots, tick)
    const entry = roundToPrecision(req.symbol, fillPrice(req.side, tick, slippage))
    const margin = requiredMargin(req.symbol, req.lots, entry)
    const fee = commission(req.symbol, req.lots)

    const { account } = get()
    if (margin + fee > account.freeMargin) {
      notify(
        'error',
        'Insufficient margin',
        `Need ${fmtMoney(margin)} margin, free ${fmtMoney(account.freeMargin)}`,
        sounds.error,
      )
      return null
    }
    const slTpErr = validateStops(req.side, entry, req.stopLoss ?? null, req.takeProfit ?? null)
    if (slTpErr) {
      notify('error', 'Invalid SL/TP', slTpErr, sounds.error)
      return null
    }

    const mark = markPrice(req.side, tick)
    const pos: Position = {
      id: uid(),
      symbol: req.symbol,
      side: req.side,
      lots: req.lots,
      units,
      entryPrice: entry,
      currentPrice: mark,
      stopLoss: req.stopLoss ?? null,
      takeProfit: req.takeProfit ?? null,
      openedAt: Date.now(),
      commission: fee,
      slippage,
      spreadCost: spreadCost(req.symbol, req.lots, tick),
      unrealizedPnl: calcPnl(req.symbol, req.side, units, entry, mark) - fee,
      margin,
    }
    // Commission is charged at open (realised cost), like a real ECN account.
    const balance = get().balance - fee
    const positions = [...get().positions, pos]
    set({ balance, positions, account: snapshot(balance, positions) })
    schedulePersist(get)

    const slipPips = (Math.abs(slippage) / inst.pipSize).toFixed(1)
    notify(
      'success',
      `${req.side} ${req.lots} ${req.symbol} filled`,
      `@ ${fmtPrice(req.symbol, entry)} · slip ${slipPips}p · comm ${fmtMoney(fee)}`,
      sounds.open,
    )
    return pos
  },

  placeOrder(req) {
    const err = validate(req)
    if (err) {
      notify('error', 'Order rejected', err, sounds.error)
      return null
    }
    const tick = useMarketStore.getState().quotes[req.symbol]
    if (tick) {
      const ref = req.side === 'BUY' ? tick.ask : tick.bid
      // Limit must be better than market; stop must be worse (standard semantics).
      const wrong =
        req.type === 'LIMIT'
          ? req.side === 'BUY'
            ? req.price >= ref
            : req.price <= ref
          : req.side === 'BUY'
            ? req.price <= ref
            : req.price >= ref
      if (wrong) {
        notify(
          'error',
          'Invalid order price',
          `${req.type} ${req.side} must be ${req.type === 'LIMIT' ? (req.side === 'BUY' ? 'below' : 'above') : req.side === 'BUY' ? 'above' : 'below'} ${fmtPrice(req.symbol, ref)}`,
          sounds.error,
        )
        return null
      }
    }
    const order: PendingOrder = {
      id: uid(),
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      lots: req.lots,
      price: roundToPrecision(req.symbol, req.price),
      stopLoss: req.stopLoss ?? null,
      takeProfit: req.takeProfit ?? null,
      createdAt: Date.now(),
      status: 'PENDING',
    }
    set({ orders: [...get().orders, order] })
    schedulePersist(get)
    notify('info', `${req.type} order placed`, `${req.side} ${req.lots} ${req.symbol} @ ${fmtPrice(req.symbol, order.price)}`, sounds.pending)
    return order
  },

  cancelOrder(id) {
    const order = get().orders.find((o) => o.id === id)
    if (!order) return
    set({ orders: get().orders.filter((o) => o.id !== id) })
    schedulePersist(get)
    notify('info', 'Order cancelled', `${order.side} ${order.lots} ${order.symbol}`)
  },

  closePosition(id, reason = 'MANUAL') {
    const pos = get().positions.find((p) => p.id === id)
    if (!pos) return
    const tick = useMarketStore.getState().quotes[pos.symbol]
    if (!tick) {
      notify('error', 'Close rejected', `No market price for ${pos.symbol}`, sounds.error)
      return
    }
    // Closing is the opposite side; slippage applies again.
    const closeSide: Side = pos.side === 'BUY' ? 'SELL' : 'BUY'
    const slip = reason === 'MANUAL' ? simulateSlippage(pos.symbol, closeSide, pos.lots, tick) : 0
    let exit = roundToPrecision(pos.symbol, fillPrice(closeSide, tick, slip))
    // SL/TP fill at the trigger price (plus any gap-through slippage already in the tick).
    if (reason === 'STOP_LOSS' && pos.stopLoss != null) exit = worseOf(pos.side, exit, pos.stopLoss)
    if (reason === 'TAKE_PROFIT' && pos.takeProfit != null) exit = pos.takeProfit

    const grossPnl = calcPnl(pos.symbol, pos.side, pos.units, pos.entryPrice, exit)
    const netPnl = grossPnl - pos.commission
    const record: TradeRecord = {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      lots: pos.lots,
      units: pos.units,
      entryPrice: pos.entryPrice,
      exitPrice: exit,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      openedAt: pos.openedAt,
      closedAt: Date.now(),
      commission: pos.commission,
      slippage: pos.slippage + slip,
      spreadCost: pos.spreadCost,
      grossPnl,
      netPnl,
      closeReason: reason,
    }
    // Commission was already deducted at open, so only gross P&L hits the balance now.
    const balance = get().balance + grossPnl
    const positions = get().positions.filter((p) => p.id !== id)
    set({ balance, positions, history: [record, ...get().history], account: snapshot(balance, positions) })
    schedulePersist(get)
    getBridge()
      .trades.insert(record)
      .catch((err) => console.error('Failed to save trade', err))

    const label = reason === 'MANUAL' ? 'Position closed' : reason.replace('_', ' ') + ' hit'
    notify(netPnl >= 0 ? 'success' : 'warn', label, `${pos.side} ${pos.lots} ${pos.symbol} → ${fmtMoney(netPnl, { sign: true })}`, sounds.close)
  },

  closeAll() {
    for (const p of [...get().positions]) get().closePosition(p.id, 'MANUAL')
  },

  modifyPosition(id, patch) {
    const pos = get().positions.find((p) => p.id === id)
    if (!pos) return
    const sl = patch.stopLoss === undefined ? pos.stopLoss : patch.stopLoss
    const tp = patch.takeProfit === undefined ? pos.takeProfit : patch.takeProfit
    const err = validateStops(pos.side, pos.currentPrice, sl, tp)
    if (err) {
      notify('error', 'Invalid SL/TP', err, sounds.error)
      return
    }
    set({ positions: get().positions.map((p) => (p.id === id ? { ...p, stopLoss: sl, takeProfit: tp } : p)) })
    schedulePersist(get)
    notify('info', 'Position modified', `${pos.symbol} SL ${sl ?? '—'} / TP ${tp ?? '—'}`)
  },

  /**
   * Hot path. Re-marks open positions, fires SL/TP, triggers pending orders and
   * enforces the stop-out level. Only touches state when something changed.
   */
  onTicks(ticks) {
    const { positions, orders } = get()
    if (!positions.length && !orders.length) return
    const bySymbol = new Map(ticks.map((t) => [t.symbol, t]))

    // 1) Re-mark positions
    let changed = false
    const toClose: { id: string; reason: CloseReason }[] = []
    const next = positions.map((p) => {
      const t = bySymbol.get(p.symbol)
      if (!t) return p
      const mark = markPrice(p.side, t)
      const unrealizedPnl = calcPnl(p.symbol, p.side, p.units, p.entryPrice, mark) - p.commission
      changed = true
      if (p.stopLoss != null && (p.side === 'BUY' ? mark <= p.stopLoss : mark >= p.stopLoss)) toClose.push({ id: p.id, reason: 'STOP_LOSS' })
      else if (p.takeProfit != null && (p.side === 'BUY' ? mark >= p.takeProfit : mark <= p.takeProfit)) toClose.push({ id: p.id, reason: 'TAKE_PROFIT' })
      return { ...p, currentPrice: mark, unrealizedPnl }
    })
    if (changed) set({ positions: next, account: snapshot(get().balance, next) })

    // 2) Fire SL/TP
    for (const c of toClose) get().closePosition(c.id, c.reason)

    // 3) Trigger pending orders
    for (const o of orders) {
      const t = bySymbol.get(o.symbol)
      if (!t) continue
      const ref = o.side === 'BUY' ? t.ask : t.bid
      const hit =
        o.type === 'LIMIT' ? (o.side === 'BUY' ? ref <= o.price : ref >= o.price) : o.side === 'BUY' ? ref >= o.price : ref <= o.price
      if (!hit) continue
      set({ orders: get().orders.filter((x) => x.id !== o.id) })
      const filled = get().openMarket({ symbol: o.symbol, side: o.side, lots: o.lots, stopLoss: o.stopLoss, takeProfit: o.takeProfit })
      if (!filled) notify('warn', 'Pending order failed', `${o.type} ${o.side} ${o.symbol} could not be filled`)
    }

    // 4) Stop-out
    const acct = get().account
    if (acct.marginLevel != null && acct.marginLevel < STOP_OUT_LEVEL && get().positions.length) {
      // Liquidate the largest loser first, like most brokers.
      const worst = [...get().positions].sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)[0]
      get().closePosition(worst.id, 'MARGIN_CALL')
    }
  },

  async resetAccount(startingBalance) {
    await getBridge().account.reset(startingBalance)
    set({
      balance: startingBalance,
      startingBalance,
      positions: [],
      orders: [],
      history: [],
      account: snapshot(startingBalance, []),
    })
    notify('info', 'Account reset', `Balance set to ${fmtMoney(startingBalance)}`)
  },
}))

function validate(req: OrderRequest): string | null {
  if (!Number.isFinite(req.lots) || req.lots <= 0) return 'Lot size must be positive'
  if (req.lots < 0.01) return 'Minimum lot size is 0.01'
  if (req.lots > 100) return 'Maximum lot size is 100'
  if (Math.round(req.lots * 100) !== req.lots * 100) return 'Lot size step is 0.01'
  return null
}

function validateStops(side: Side, price: number, sl: number | null, tp: number | null): string | null {
  if (sl != null && (side === 'BUY' ? sl >= price : sl <= price)) return `Stop loss must be ${side === 'BUY' ? 'below' : 'above'} ${price}`
  if (tp != null && (side === 'BUY' ? tp <= price : tp >= price)) return `Take profit must be ${side === 'BUY' ? 'above' : 'below'} ${price}`
  return null
}

/** For stop-loss fills, use the worse of trigger price and actual mark (gap-through). */
function worseOf(side: Side, mark: number, trigger: number): number {
  return side === 'BUY' ? Math.min(mark, trigger) : Math.max(mark, trigger)
}
