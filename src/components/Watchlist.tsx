import { memo, useEffect, useRef, useState } from 'react'
import { INSTRUMENTS } from '@shared/instruments'
import { fmtPct, fmtPrice, cls } from '../lib/format'
import { useMarketStore } from '../store/marketStore'

/**
 * Left panel: every instrument with bid/ask, daily % change and a sparkline.
 * Rows are memoised and subscribe to their own quote so a tick on EURUSD
 * doesn't re-render the Gold row.
 */
export default function Watchlist() {
  const [filter, setFilter] = useState('')
  const list = INSTRUMENTS.filter((i) => i.symbol.toLowerCase().includes(filter.toLowerCase()) || i.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search symbol…"
          className="w-full rounded border border-line bg-surface-0 px-2 py-1 font-sans text-xs text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center border-b border-line px-3 py-1 font-sans text-[10px] uppercase tracking-wider text-fg-dim">
        <span>Symbol</span>
        <span className="text-right">Bid / Ask</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.map((i) => (
          <Row key={i.symbol} symbol={i.symbol} />
        ))}
      </div>
    </div>
  )
}

const Row = memo(function Row({ symbol }: { symbol: string }) {
  const quote = useMarketStore((s) => s.quotes[symbol])
  const selected = useMarketStore((s) => s.selectedSymbol === symbol)
  const select = useMarketStore((s) => s.selectSymbol)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!quote || quote.mid === quote.prevMid) return
    setFlash(quote.mid > quote.prevMid ? 'up' : 'down')
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFlash(null), 600)
  }, [quote])

  const up = (quote?.changePct ?? 0) >= 0
  return (
    <button
      onClick={() => select(symbol)}
      className={cls(
        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-line/60 px-3 py-2 text-left transition-colors',
        selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
        flash === 'up' && 'animate-flash-up',
        flash === 'down' && 'animate-flash-down',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-sans text-xs font-semibold text-fg">{symbol}</span>
          <span className={cls('font-mono text-[10px]', up ? 'text-bull' : 'text-bear')}>{fmtPct(quote?.changePct)}</span>
        </div>
        <Sparkline data={quote?.sparkline ?? []} up={up} />
      </div>
      <div className="text-right font-mono text-xs leading-tight">
        <div className={cls(quote && quote.mid >= quote.prevMid ? 'text-bull' : 'text-bear')}>{fmtPrice(symbol, quote?.bid)}</div>
        <div className="text-fg-muted">{fmtPrice(symbol, quote?.ask)}</div>
      </div>
    </button>
  )
})

/** Tiny SVG sparkline, 60 points max; cheap enough to render on every tick. */
function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  const w = 80
  const h = 18
  if (data.length < 2) return <div style={{ width: w, height: h }} className="mt-1" />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1e-9
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 2) - 1).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} className="mt-1 block" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? '#00ff88' : '#ff3b3b'} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
