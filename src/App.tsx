import { useEffect } from 'react'
import BottomPanel from './components/BottomPanel'
import Chart from './components/Chart'
import Header from './components/Header'
import OrderPanel from './components/OrderPanel'
import SettingsModal from './components/SettingsModal'
import Toasts from './components/Toasts'
import Watchlist from './components/Watchlist'
import { useMarketData } from './hooks/useMarketData'
import { cls } from './lib/format'
import { useSettingsStore } from './store/settingsStore'
import { useTradeStore } from './store/tradeStore'
import { useUiStore } from './store/uiStore'

/**
 * Root layout (CSS grid):
 *
 *  ┌──────────────────── Header ────────────────────┐
 *  │ Watchlist │        Chart          │ OrderPanel │
 *  │           ├───────────────────────┤            │
 *  │           │      BottomPanel      │            │
 *  └────────────────────────────────────────────────┘
 *
 * Side panels collapse automatically under 1024px / 768px and can be toggled
 * manually from the header, so the chart always keeps the lion's share.
 */
export default function App() {
  const loadSettings = useSettingsStore((s) => s.load)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const hydrate = useTradeStore((s) => s.hydrate)
  const hydrated = useTradeStore((s) => s.hydrated)
  const leftCollapsed = useUiStore((s) => s.leftCollapsed)
  const rightCollapsed = useUiStore((s) => s.rightCollapsed)
  const bottomCollapsed = useUiStore((s) => s.bottomCollapsed)

  useEffect(() => {
    void loadSettings()
    void hydrate()
  }, [loadSettings, hydrate])

  useMarketData()

  if (!settingsLoaded || !hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-0 font-sans text-sm text-fg-muted">
        <span className="animate-pulse">Loading msTrader…</span>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg">
      <Header />
      <div
        className={cls(
          'grid min-h-0 flex-1',
          // Column template responds to collapse state; side panels have fixed widths.
          leftCollapsed ? 'grid-cols-[0_minmax(0,1fr)]' : 'grid-cols-[220px_minmax(0,1fr)]',
          'md:[grid-template-columns:var(--cols)]',
        )}
        style={
          {
            '--cols': `${leftCollapsed ? '0px' : '220px'} minmax(0,1fr) ${rightCollapsed ? '0px' : '260px'}`,
          } as React.CSSProperties
        }
      >
        <aside className={cls('min-h-0 overflow-hidden border-r border-line bg-surface-1', leftCollapsed && 'hidden')}>
          <Watchlist />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className={cls('min-h-0 flex-1', bottomCollapsed ? '' : 'basis-[60%]')}>
            <Chart />
          </div>
          <section className={cls('flex min-h-0 flex-col border-t border-line bg-surface-1', bottomCollapsed ? 'h-8' : 'h-[40%] min-h-[120px]')}>
            <BottomPanel />
          </section>
        </main>

        <aside className={cls('hidden min-h-0 overflow-hidden border-l border-line bg-surface-1 md:block', rightCollapsed && 'md:hidden')}>
          <OrderPanel />
        </aside>
      </div>

      {/* Mobile-width fallback: order panel slides in as a sheet under 768px */}
      {!rightCollapsed && (
        <div className="fixed inset-x-0 bottom-0 z-30 max-h-[70vh] overflow-y-auto border-t border-line bg-surface-1 md:hidden">
          <OrderPanel />
        </div>
      )}

      <SettingsModal />
      <Toasts />
    </div>
  )
}
