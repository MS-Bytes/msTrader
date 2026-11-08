import { cls, fmtMoney } from '../lib/format'
import { useMarketStore } from '../store/marketStore'
import { useTradeStore } from '../store/tradeStore'
import { useUiStore } from '../store/uiStore'

/** Top bar: brand, feed status, account equity strip, panel toggles, settings. */
export default function Header() {
  const feed = useMarketStore((s) => s.feed)
  const account = useTradeStore((s) => s.account)
  const toggle = useUiStore((s) => s.toggle)
  const left = useUiStore((s) => s.leftCollapsed)
  const right = useUiStore((s) => s.rightCollapsed)
  const openSettings = useUiStore((s) => s.setSettingsOpen)

  const dot =
    feed.status === 'live' ? 'bg-bull shadow-[0_0_8px_#00ff88]' : feed.status === 'connecting' ? 'bg-warn animate-pulse' : feed.status === 'degraded' ? 'bg-warn' : 'bg-bear'

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-3">
      <div className="flex items-center gap-2">
        <span className="font-sans text-sm font-bold tracking-tight text-fg">
          ms<span className="text-bull">Trader</span>
        </span>
        <span className="hidden rounded bg-surface-3 px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-wider text-fg-muted sm:inline">Paper</span>
      </div>

      <div className="flex items-center gap-1.5 font-sans text-[11px] text-fg-muted" title={feed.message}>
        <span className={cls('inline-block h-2 w-2 rounded-full', dot)} />
        <span className="font-mono">{feed.source}</span>
        <span className="hidden md:inline">· {feed.message ?? feed.status}</span>
      </div>

      <div className="ml-auto hidden items-center gap-4 font-mono text-[11px] md:flex">
        <Kv k="Balance" v={fmtMoney(account.balance)} />
        <Kv k="Equity" v={fmtMoney(account.equity)} />
        <Kv k="P&L" v={fmtMoney(account.unrealizedPnl, { sign: true })} tone={account.unrealizedPnl >= 0 ? 'bull' : 'bear'} />
        <Kv k="Free" v={fmtMoney(account.freeMargin)} />
      </div>

      <div className="flex items-center gap-1 md:ml-2">
        <IconBtn active={!left} onClick={() => toggle('left')} title="Toggle watchlist">⊟</IconBtn>
        <IconBtn active={!right} onClick={() => toggle('right')} title="Toggle order panel">⊞</IconBtn>
        <IconBtn onClick={() => openSettings(true)} title="Settings">⚙</IconBtn>
      </div>
    </header>
  )
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: 'bull' | 'bear' }) {
  return (
    <span>
      <span className="font-sans text-fg-dim">{k} </span>
      <span className={cls(tone === 'bull' && 'text-bull', tone === 'bear' && 'text-bear', !tone && 'text-fg')}>{v}</span>
    </span>
  )
}

function IconBtn({ children, onClick, title, active = true }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={cls('rounded px-2 py-0.5 text-sm hover:bg-surface-3', active ? 'text-fg' : 'text-fg-dim')}>
      {children}
    </button>
  )
}
