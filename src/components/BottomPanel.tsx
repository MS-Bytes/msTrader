import { useMemo, useState } from 'react'
import type { Position } from '@shared/types'
import { cls, fmtDateTime, fmtLots, fmtMoney, fmtPrice, fmtTime, pips } from '../lib/format'
import { useTradeStore } from '../store/tradeStore'
import { useUiStore } from '../store/uiStore'

const TABS = [
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Open Orders' },
  { id: 'history', label: 'Account History' },
] as const

/** Bottom dock: Positions / Open Orders / Account History. */
export default function BottomPanel() {
  const tab = useUiStore((s) => s.bottomTab)
  const setTab = useUiStore((s) => s.setBottomTab)
  const collapsed = useUiStore((s) => s.bottomCollapsed)
  const toggle = useUiStore((s) => s.toggle)
  const positions = useTradeStore((s) => s.positions)
  const orders = useTradeStore((s) => s.orders)
  const history = useTradeStore((s) => s.history)
  const closeAll = useTradeStore((s) => s.closeAll)

  const counts = { positions: positions.length, orders: orders.length, history: history.length }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-line bg-surface-1 px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cls(
              'border-b-2 px-3 py-1.5 font-sans text-xs transition',
              tab === t.id && !collapsed ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
            {counts[t.id] > 0 && <span className="ml-1.5 rounded bg-surface-3 px-1 font-mono text-[10px] text-fg-muted">{counts[t.id]}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {tab === 'positions' && positions.length > 0 && (
            <button onClick={closeAll} className="rounded border border-bear/50 px-2 py-0.5 font-sans text-[11px] text-bear hover:bg-bear/10">
              Close all
            </button>
          )}
          <button onClick={() => toggle('bottom')} className="px-2 font-mono text-fg-muted hover:text-fg" title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === 'positions' && <PositionsTable />}
          {tab === 'orders' && <OrdersTable />}
          {tab === 'history' && <HistoryTable />}
        </div>
      )}
    </div>
  )
}

const th = 'sticky top-0 bg-surface-1 px-2 py-1 text-left font-sans text-[10px] font-medium uppercase tracking-wider text-fg-dim whitespace-nowrap'
const td = 'px-2 py-1 font-mono text-[11px] whitespace-nowrap'

function Empty({ children }: { children: string }) {
  return <div className="p-6 text-center font-sans text-xs text-fg-dim">{children}</div>
}

function PositionsTable() {
  const positions = useTradeStore((s) => s.positions)
  if (!positions.length) return <Empty>No open positions</Empty>
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {['Symbol', 'Side', 'Lots', 'Entry', 'Current', 'Pips', 'SL', 'TP', 'Margin', 'Comm.', 'P&L', 'Opened', ''].map((h) => (
            <th key={h} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <PositionRow key={p.id} p={p} />
        ))}
      </tbody>
    </table>
  )
}

function PositionRow({ p }: { p: Position }) {
  const closePosition = useTradeStore((s) => s.closePosition)
  const modify = useTradeStore((s) => s.modifyPosition)
  const [editing, setEditing] = useState(false)
  const [sl, setSl] = useState(p.stopLoss?.toString() ?? '')
  const [tp, setTp] = useState(p.takeProfit?.toString() ?? '')
  const diff = p.side === 'BUY' ? p.currentPrice - p.entryPrice : p.entryPrice - p.currentPrice
  const pnlTone = p.unrealizedPnl >= 0 ? 'text-bull' : 'text-bear'

  const save = () => {
    modify(p.id, { stopLoss: sl.trim() ? Number(sl) : null, takeProfit: tp.trim() ? Number(tp) : null })
    setEditing(false)
  }

  return (
    <tr className="border-b border-line/60 hover:bg-surface-2/50">
      <td className={cls(td, 'font-sans font-semibold text-fg')}>{p.symbol}</td>
      <td className={cls(td, p.side === 'BUY' ? 'text-bull' : 'text-bear')}>{p.side}</td>
      <td className={cls(td, 'text-fg')}>{fmtLots(p.lots)}</td>
      <td className={cls(td, 'text-fg-muted')}>{fmtPrice(p.symbol, p.entryPrice)}</td>
      <td className={cls(td, 'text-fg')}>{fmtPrice(p.symbol, p.currentPrice)}</td>
      <td className={cls(td, pnlTone)}>{pips(p.symbol, diff)}</td>
      <td className={td}>
        {editing ? <Inline value={sl} onChange={setSl} /> : <span className="text-bear">{p.stopLoss != null ? fmtPrice(p.symbol, p.stopLoss) : '—'}</span>}
      </td>
      <td className={td}>
        {editing ? <Inline value={tp} onChange={setTp} /> : <span className="text-bull">{p.takeProfit != null ? fmtPrice(p.symbol, p.takeProfit) : '—'}</span>}
      </td>
      <td className={cls(td, 'text-fg-muted')}>{fmtMoney(p.margin)}</td>
      <td className={cls(td, 'text-fg-muted')}>{fmtMoney(p.commission)}</td>
      <td className={cls(td, 'font-semibold', pnlTone)}>{fmtMoney(p.unrealizedPnl, { sign: true })}</td>
      <td className={cls(td, 'text-fg-dim')}>{fmtTime(p.openedAt)}</td>
      <td className={cls(td, 'text-right')}>
        {editing ? (
          <>
            <button onClick={save} className="mr-1 rounded bg-accent/20 px-2 py-0.5 font-sans text-accent hover:bg-accent/30">Save</button>
            <button onClick={() => setEditing(false)} className="rounded px-2 py-0.5 font-sans text-fg-muted hover:text-fg">Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="mr-1 rounded px-2 py-0.5 font-sans text-fg-muted hover:bg-surface-3 hover:text-fg">Edit</button>
            <button onClick={() => closePosition(p.id)} className="rounded bg-bear/15 px-2 py-0.5 font-sans text-bear hover:bg-bear/25">Close</button>
          </>
        )}
      </td>
    </tr>
  )
}

function Inline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-20 rounded border border-line bg-surface-0 px-1 font-mono text-[11px] text-fg focus:border-accent focus:outline-none"
    />
  )
}

function OrdersTable() {
  const orders = useTradeStore((s) => s.orders)
  const cancel = useTradeStore((s) => s.cancelOrder)
  if (!orders.length) return <Empty>No pending orders</Empty>
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {['Symbol', 'Type', 'Side', 'Lots', 'Price', 'SL', 'TP', 'Created', ''].map((h) => (
            <th key={h} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="border-b border-line/60 hover:bg-surface-2/50">
            <td className={cls(td, 'font-sans font-semibold text-fg')}>{o.symbol}</td>
            <td className={cls(td, 'text-warn')}>{o.type}</td>
            <td className={cls(td, o.side === 'BUY' ? 'text-bull' : 'text-bear')}>{o.side}</td>
            <td className={cls(td, 'text-fg')}>{fmtLots(o.lots)}</td>
            <td className={cls(td, 'text-fg')}>{fmtPrice(o.symbol, o.price)}</td>
            <td className={cls(td, 'text-bear')}>{o.stopLoss != null ? fmtPrice(o.symbol, o.stopLoss) : '—'}</td>
            <td className={cls(td, 'text-bull')}>{o.takeProfit != null ? fmtPrice(o.symbol, o.takeProfit) : '—'}</td>
            <td className={cls(td, 'text-fg-dim')}>{fmtTime(o.createdAt)}</td>
            <td className={cls(td, 'text-right')}>
              <button onClick={() => cancel(o.id)} className="rounded bg-bear/15 px-2 py-0.5 font-sans text-bear hover:bg-bear/25">Cancel</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function HistoryTable() {
  const history = useTradeStore((s) => s.history)
  const stats = useMemo(() => {
    const net = history.reduce((s, t) => s + t.netPnl, 0)
    const wins = history.filter((t) => t.netPnl > 0).length
    const fees = history.reduce((s, t) => s + t.commission, 0)
    return { net, wins, fees, winRate: history.length ? (wins / history.length) * 100 : 0 }
  }, [history])

  if (!history.length) return <Empty>No closed trades yet</Empty>
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line bg-surface-0 px-3 py-1.5 font-mono text-[11px]">
        <Stat k="Trades" v={String(history.length)} />
        <Stat k="Win rate" v={`${stats.winRate.toFixed(0)}%`} />
        <Stat k="Net P&L" v={fmtMoney(stats.net, { sign: true })} tone={stats.net >= 0 ? 'bull' : 'bear'} />
        <Stat k="Fees paid" v={fmtMoney(stats.fees)} />
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['Symbol', 'Side', 'Lots', 'Entry', 'Exit', 'Pips', 'Gross', 'Comm.', 'Net', 'Reason', 'Opened', 'Closed'].map((h) => (
              <th key={h} className={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((t) => {
            const diff = t.side === 'BUY' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice
            const tone = t.netPnl >= 0 ? 'text-bull' : 'text-bear'
            return (
              <tr key={t.id} className="border-b border-line/60 hover:bg-surface-2/50">
                <td className={cls(td, 'font-sans font-semibold text-fg')}>{t.symbol}</td>
                <td className={cls(td, t.side === 'BUY' ? 'text-bull' : 'text-bear')}>{t.side}</td>
                <td className={cls(td, 'text-fg')}>{fmtLots(t.lots)}</td>
                <td className={cls(td, 'text-fg-muted')}>{fmtPrice(t.symbol, t.entryPrice)}</td>
                <td className={cls(td, 'text-fg-muted')}>{fmtPrice(t.symbol, t.exitPrice)}</td>
                <td className={cls(td, tone)}>{pips(t.symbol, diff)}</td>
                <td className={cls(td, 'text-fg-muted')}>{fmtMoney(t.grossPnl, { sign: true })}</td>
                <td className={cls(td, 'text-fg-muted')}>{fmtMoney(t.commission)}</td>
                <td className={cls(td, 'font-semibold', tone)}>{fmtMoney(t.netPnl, { sign: true })}</td>
                <td className={cls(td, 'font-sans text-fg-dim')}>{t.closeReason.replace('_', ' ')}</td>
                <td className={cls(td, 'text-fg-dim')}>{fmtDateTime(t.openedAt)}</td>
                <td className={cls(td, 'text-fg-dim')}>{fmtDateTime(t.closedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) {
  return (
    <span>
      <span className="font-sans text-fg-dim">{k} </span>
      <span className={cls(tone === 'bull' && 'text-bull', tone === 'bear' && 'text-bear', !tone && 'text-fg')}>{v}</span>
    </span>
  )
}
