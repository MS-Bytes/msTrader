import { useEffect, useMemo, useState } from 'react'
import { getInstrument } from '@shared/instruments'
import type { OrderType, Side } from '@shared/types'
import { cls, fmtMoney, fmtPrice } from '../lib/format'
import { commission, pipValueUsd, requiredMargin, spreadCost } from '../lib/pricing'
import { useMarketStore } from '../store/marketStore'
import { useSettingsStore } from '../store/settingsStore'
import { useTradeStore } from '../store/tradeStore'

const ORDER_TYPES: OrderType[] = ['MARKET', 'LIMIT', 'STOP']

/**
 * Right panel: order ticket with live cost preview (margin, spread, commission,
 * pip value) and account summary.
 */
export default function OrderPanel() {
  const symbol = useMarketStore((s) => s.selectedSymbol)
  const quote = useMarketStore((s) => s.quotes[symbol])
  const account = useTradeStore((s) => s.account)
  const openMarket = useTradeStore((s) => s.openMarket)
  const placeOrder = useTradeStore((s) => s.placeOrder)
  const defaultLots = useSettingsStore((s) => s.settings.defaultLots)

  const inst = useMemo(() => getInstrument(symbol), [symbol])
  const [type, setType] = useState<OrderType>('MARKET')
  const [lots, setLots] = useState(String(defaultLots))
  const [price, setPrice] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')

  useEffect(() => setLots(String(defaultLots)), [defaultLots])
  // Reset ticket when switching instruments (prices are not comparable).
  useEffect(() => {
    setPrice('')
    setSl('')
    setTp('')
  }, [symbol])

  const lotsNum = Number(lots) || 0
  const refPrice = quote?.ask ?? 0
  const margin = refPrice ? requiredMargin(symbol, lotsNum, refPrice) : 0
  const comm = commission(symbol, lotsNum)
  const spread = quote ? spreadCost(symbol, lotsNum, quote) : 0
  const pipVal = refPrice ? pipValueUsd(symbol, lotsNum, refPrice) : 0
  const spreadPips = quote ? ((quote.ask - quote.bid) / inst.pipSize).toFixed(1) : '—'
  const canAfford = margin + comm <= account.freeMargin && lotsNum > 0

  const parse = (v: string): number | null => (v.trim() === '' ? null : Number(v))

  const submit = (side: Side) => {
    const stopLoss = parse(sl)
    const takeProfit = parse(tp)
    if (type === 'MARKET') {
      openMarket({ symbol, side, lots: lotsNum, stopLoss, takeProfit })
    } else {
      const p = parse(price)
      if (p == null || !Number.isFinite(p)) return
      placeOrder({ symbol, side, type, lots: lotsNum, price: p, stopLoss, takeProfit })
    }
  }

  const step = (delta: number) => setLots((v) => Math.max(0.01, Math.round(((Number(v) || 0) + delta) * 100) / 100).toFixed(2))

  // Quick SL/TP helpers in pips from the current market.
  const quickStops = (pips: number) => {
    if (!quote) return
    const d = pips * inst.pipSize
    setSl((quote.bid - d).toFixed(inst.precision))
    setTp((quote.ask + d).toFixed(inst.precision))
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/* Big quote */}
      <div className="grid grid-cols-2 gap-2 border-b border-line p-3">
        <QuoteBox label="SELL" value={fmtPrice(symbol, quote?.bid)} tone="bear" />
        <QuoteBox label="BUY" value={fmtPrice(symbol, quote?.ask)} tone="bull" />
        <div className="col-span-2 text-center font-mono text-[10px] text-fg-dim">
          spread <span className="text-warn">{spreadPips}</span> pips
        </div>
      </div>

      {/* Ticket */}
      <div className="space-y-3 p-3">
        <div className="flex gap-0.5 rounded bg-surface-2 p-0.5">
          {ORDER_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cls('flex-1 rounded py-1 font-sans text-xs transition', t === type ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg')}
            >
              {t}
            </button>
          ))}
        </div>

        <Field label="Lot size">
          <div className="flex">
            <button onClick={() => step(-0.01)} className="rounded-l border border-line bg-surface-2 px-2 text-fg-muted hover:text-fg">−</button>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={lots}
              onChange={(e) => setLots(e.target.value)}
              className="w-full border-y border-line bg-surface-0 px-2 py-1 text-center font-mono text-sm text-fg focus:outline-none"
            />
            <button onClick={() => step(0.01)} className="rounded-r border border-line bg-surface-2 px-2 text-fg-muted hover:text-fg">+</button>
          </div>
          <div className="mt-1 flex gap-1">
            {[0.01, 0.1, 0.5, 1].map((l) => (
              <button key={l} onClick={() => setLots(l.toFixed(2))} className="flex-1 rounded bg-surface-2 py-0.5 font-mono text-[10px] text-fg-muted hover:text-fg">
                {l}
              </button>
            ))}
          </div>
        </Field>

        {type !== 'MARKET' && (
          <Field label={`${type} price`}>
            <PriceInput value={price} onChange={setPrice} precision={inst.precision} placeholder={fmtPrice(symbol, quote?.mid)} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Stop loss">
            <PriceInput value={sl} onChange={setSl} precision={inst.precision} placeholder="none" />
          </Field>
          <Field label="Take profit">
            <PriceInput value={tp} onChange={setTp} precision={inst.precision} placeholder="none" />
          </Field>
        </div>
        <div className="flex gap-1">
          {[10, 20, 50].map((p) => (
            <button key={p} onClick={() => quickStops(p)} className="flex-1 rounded bg-surface-2 py-0.5 font-mono text-[10px] text-fg-muted hover:text-fg">
              ±{p}p
            </button>
          ))}
          <button onClick={() => { setSl(''); setTp('') }} className="flex-1 rounded bg-surface-2 py-0.5 font-sans text-[10px] text-fg-muted hover:text-fg">
            clear
          </button>
        </div>

        {/* Cost preview */}
        <div className="space-y-1 rounded border border-line bg-surface-0 p-2 font-mono text-[11px]">
          <Line k="Units" v={(lotsNum * inst.contractSize).toLocaleString()} />
          <Line k="Margin req." v={fmtMoney(margin)} warn={!canAfford} />
          <Line k="Spread cost" v={fmtMoney(spread)} />
          <Line k="Commission" v={fmtMoney(comm)} />
          <Line k="Pip value" v={fmtMoney(pipVal)} />
          <Line k="Leverage" v={`1:${inst.leverage}`} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={!quote || !canAfford}
            onClick={() => submit('SELL')}
            className="rounded bg-bear py-2.5 font-sans text-sm font-bold text-white shadow-[0_0_14px_rgba(255,59,59,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            SELL
            <div className="font-mono text-[10px] font-normal opacity-90">{fmtPrice(symbol, quote?.bid)}</div>
          </button>
          <button
            disabled={!quote || !canAfford}
            onClick={() => submit('BUY')}
            className="rounded bg-bull py-2.5 font-sans text-sm font-bold text-black shadow-[0_0_14px_rgba(0,255,136,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            BUY
            <div className="font-mono text-[10px] font-normal opacity-80">{fmtPrice(symbol, quote?.ask)}</div>
          </button>
        </div>
        {!canAfford && lotsNum > 0 && <p className="text-center font-sans text-[11px] text-bear">Insufficient free margin</p>}
      </div>

      {/* Account */}
      <div className="mt-auto space-y-1 border-t border-line p-3 font-mono text-[11px]">
        <div className="mb-1 font-sans text-[10px] uppercase tracking-wider text-fg-dim">Account</div>
        <Line k="Balance" v={fmtMoney(account.balance)} />
        <Line k="Equity" v={fmtMoney(account.equity)} />
        <Line k="Unrealised" v={fmtMoney(account.unrealizedPnl, { sign: true })} tone={account.unrealizedPnl >= 0 ? 'bull' : 'bear'} />
        <Line k="Margin used" v={fmtMoney(account.marginUsed)} />
        <Line k="Free margin" v={fmtMoney(account.freeMargin)} />
        <Line
          k="Margin level"
          v={account.marginLevel == null ? '—' : `${account.marginLevel.toFixed(0)}%`}
          warn={account.marginLevel != null && account.marginLevel < 100}
        />
      </div>
    </div>
  )
}

function QuoteBox({ label, value, tone }: { label: string; value: string; tone: 'bull' | 'bear' }) {
  return (
    <div className={cls('rounded border p-2 text-center', tone === 'bull' ? 'border-bull/40' : 'border-bear/40')}>
      <div className="font-sans text-[10px] text-fg-dim">{label}</div>
      <div className={cls('font-mono text-lg font-semibold', tone === 'bull' ? 'text-bull' : 'text-bear')}>{value}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 font-sans text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      {children}
    </label>
  )
}

function PriceInput({ value, onChange, precision, placeholder }: { value: string; onChange: (v: string) => void; precision: number; placeholder?: string }) {
  return (
    <input
      type="number"
      step={Math.pow(10, -precision)}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-line bg-surface-0 px-2 py-1 font-mono text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
    />
  )
}

function Line({ k, v, tone, warn }: { k: string; v: string; tone?: 'bull' | 'bear'; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="font-sans text-fg-dim">{k}</span>
      <span className={cls(tone === 'bull' && 'text-bull', tone === 'bear' && 'text-bear', warn && 'text-warn', !tone && !warn && 'text-fg')}>{v}</span>
    </div>
  )
}
