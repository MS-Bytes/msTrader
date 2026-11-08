import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { getInstrument } from '@shared/instruments'
import type { Candle, Timeframe } from '@shared/types'
import { TIMEFRAME_SECONDS } from '@shared/types'
import { useCandles } from '../hooks/useMarketData'
import { fmtPrice } from '../lib/format'
import { DEFAULT_INDICATORS, type IndicatorConfig, type LinePoint } from '../lib/indicators'
import { useMarketStore } from '../store/marketStore'
import { useTradeStore } from '../store/tradeStore'
import type { IndicatorRequest, IndicatorResponse } from '../workers/indicator.worker'

const BULL = '#00ff88'
const BEAR = '#ff3b3b'
const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d']

/** Resolve a CSS variable like "11 14 20" to an rgb() string for the chart. */
function cssRgb(name: string, alpha = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return `rgba(${v.split(' ').join(',')},${alpha})`
}

/**
 * Main price chart: candlesticks + volume, SMA/EMA overlays, RSI pane,
 * live position/order price lines. Uses TradingView lightweight-charts v5.
 *
 * Perf notes:
 *  - Only the last bar is pushed via series.update() on each tick.
 *  - Indicators are computed in a Web Worker and only re-run when a new bar opens
 *    or an indicator toggle changes (not on every tick).
 */
export default function Chart() {
  const symbol = useMarketStore((s) => s.selectedSymbol)
  const timeframe = useMarketStore((s) => s.timeframe)
  const setTimeframe = useMarketStore((s) => s.setTimeframe)
  const quote = useMarketStore((s) => s.quotes[symbol])
  const positions = useTradeStore((s) => s.positions)
  const orders = useTradeStore((s) => s.orders)

  const { candles, loading, error, lastUpdate, version } = useCandles(symbol, timeframe)
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(DEFAULT_INDICATORS)
  const [menuOpen, setMenuOpen] = useState(false)
  const [hover, setHover] = useState<Candle | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const priceLinesRef = useRef<IPriceLine[]>([])
  const workerRef = useRef<Worker | null>(null)
  const reqIdRef = useRef(0)
  const lastBarTimeRef = useRef<number>(0)

  const inst = useMemo(() => getInstrument(symbol), [symbol])
  const enabledIndicators = useMemo(() => indicators.filter((i) => i.enabled), [indicators])

  // ---- Create chart once ---------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: cssRgb('--surface-0') },
        textColor: cssRgb('--fg-muted'),
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 11,
        panes: { separatorColor: cssRgb('--line'), separatorHoverColor: cssRgb('--line', 0.6), enableResize: true },
      },
      grid: { vertLines: { color: cssRgb('--line', 0.35) }, horzLines: { color: cssRgb('--line', 0.35) } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: cssRgb('--line'), scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: cssRgb('--line'), timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8 },
      localization: { priceFormatter: (p: number) => p.toFixed(inst.precision) },
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: BULL,
      downColor: BEAR,
      borderUpColor: BULL,
      borderDownColor: BEAR,
      wickUpColor: BULL,
      wickDownColor: BEAR,
      priceFormat: { type: 'price', precision: inst.precision, minMove: inst.pipSize / 10 },
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(candleSeries) as Candle | undefined
      setHover(d && 'open' in d ? d : null)
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    const worker = new Worker(new URL('../workers/indicator.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    // Re-skin when the theme class flips (Dark/Light/Auto).
    const observer = new MutationObserver(() => {
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: cssRgb('--surface-0') }, textColor: cssRgb('--fg-muted') },
        grid: { vertLines: { color: cssRgb('--line', 0.35) }, horzLines: { color: cssRgb('--line', 0.35) } },
      })
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      worker.terminate()
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      indicatorSeriesRef.current.clear()
    }
    // Chart is recreated when the symbol changes so price formatting is exact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  // ---- Load full history ---------------------------------------------------
  useEffect(() => {
    const cs = candleSeriesRef.current
    const vs = volumeSeriesRef.current
    if (!cs || !vs || !candles.length) return
    cs.setData(candles.map(toBar))
    vs.setData(candles.map(toVolume))
    lastBarTimeRef.current = candles[candles.length - 1].time
    chartRef.current?.timeScale().scrollToRealTime()
    runIndicators(candles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  // ---- Live bar updates ----------------------------------------------------
  useEffect(() => {
    if (!lastUpdate) return
    candleSeriesRef.current?.update(toBar(lastUpdate))
    volumeSeriesRef.current?.update(toVolume(lastUpdate))
    // New bar opened → recompute indicators off-thread.
    if (lastUpdate.time !== lastBarTimeRef.current) {
      lastBarTimeRef.current = lastUpdate.time
      runIndicators(candles)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUpdate])

  // ---- Indicator toggles ---------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const live = indicatorSeriesRef.current
    // Remove series that were disabled.
    for (const [id, s] of live) {
      if (!enabledIndicators.some((i) => i.id === id)) {
        chart.removeSeries(s)
        live.delete(id)
      }
    }
    // Add newly enabled series. RSI goes to a second pane.
    for (const ind of enabledIndicators) {
      if (live.has(ind.id)) continue
      const paneIndex = ind.kind === 'RSI' ? 1 : 0
      const s = chart.addSeries(
        LineSeries,
        { color: ind.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: ind.kind === 'RSI', title: `${ind.kind}${ind.period}` },
        paneIndex,
      )
      live.set(ind.id, s)
    }
    const rsiPane = chart.panes()[1]
    if (rsiPane) rsiPane.setHeight(enabledIndicators.some((i) => i.kind === 'RSI') ? 110 : 0)
    if (candles.length) runIndicators(candles)
    // `symbol` is a dep because the chart (and its series) is rebuilt per symbol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledIndicators, symbol])

  // ---- Position / order price lines ---------------------------------------
  useEffect(() => {
    const cs = candleSeriesRef.current
    if (!cs) return
    for (const l of priceLinesRef.current) cs.removePriceLine(l)
    priceLinesRef.current = []
    const add = (price: number, color: string, title: string, style: 0 | 2 = 0) =>
      priceLinesRef.current.push(cs.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }))
    for (const p of positions.filter((p) => p.symbol === symbol)) {
      add(p.entryPrice, p.side === 'BUY' ? BULL : BEAR, `${p.side} ${p.lots}`)
      if (p.stopLoss != null) add(p.stopLoss, BEAR, 'SL', 2)
      if (p.takeProfit != null) add(p.takeProfit, BULL, 'TP', 2)
    }
    for (const o of orders.filter((o) => o.symbol === symbol)) add(o.price, '#fbbf24', `${o.type} ${o.side}`, 2)
  }, [positions, orders, symbol, version])

  function runIndicators(data: Candle[]): void {
    const worker = workerRef.current
    if (!worker || !enabledIndicators.length) return
    const reqId = ++reqIdRef.current
    const req: IndicatorRequest = { reqId, candles: data, indicators: enabledIndicators.map(({ id, kind, period }) => ({ id, kind, period })) }
    worker.onmessage = (e: MessageEvent<IndicatorResponse>) => {
      if (e.data.reqId !== reqIdRef.current) return // stale
      for (const [id, points] of Object.entries(e.data.results)) {
        indicatorSeriesRef.current.get(id)?.setData(points.map(toLine))
      }
    }
    worker.postMessage(req)
  }

  const toggleIndicator = (id: string) => setIndicators((list) => list.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i)))

  const shown = hover ?? candles[candles.length - 1]
  const spreadPips = quote ? ((quote.ask - quote.bid) / inst.pipSize).toFixed(1) : '—'

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="font-sans text-sm font-semibold text-fg">{symbol}</span>
          <span className="hidden font-sans text-fg-dim lg:inline">{inst.name}</span>
        </div>
        <div className="flex gap-0.5 rounded bg-surface-2 p-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`rounded px-2 py-0.5 font-mono transition ${tf === timeframe ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg'}`}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded border border-line bg-surface-2 px-2 py-0.5 font-sans text-fg-muted hover:text-fg"
          >
            Indicators {enabledIndicators.length ? `(${enabledIndicators.length})` : ''} ▾
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded border border-line bg-surface-2 p-1 shadow-xl" onMouseLeave={() => setMenuOpen(false)}>
              {indicators.map((ind) => (
                <label key={ind.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 font-sans hover:bg-surface-3">
                  <input type="checkbox" checked={ind.enabled} onChange={() => toggleIndicator(ind.id)} className="accent-accent" />
                  <span className="h-2 w-2 rounded-full" style={{ background: ind.color }} />
                  <span className="text-fg">
                    {ind.kind} {ind.period}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        {/* OHLC readout */}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 font-mono text-fg-muted">
          {shown && (
            <>
              <Ohlc label="O" v={fmtPrice(symbol, shown.open)} />
              <Ohlc label="H" v={fmtPrice(symbol, shown.high)} />
              <Ohlc label="L" v={fmtPrice(symbol, shown.low)} />
              <Ohlc label="C" v={fmtPrice(symbol, shown.close)} color={shown.close >= shown.open ? BULL : BEAR} />
            </>
          )}
          {quote && (
            <span className="hidden sm:inline">
              <span className="text-fg-dim">Spread </span>
              <span className="text-warn">{spreadPips}p</span>
            </span>
          )}
        </div>
      </div>

      {/* Chart surface */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && <Overlay>Loading {symbol} {timeframe} history…</Overlay>}
        {!loading && error && <Overlay>{error}</Overlay>}
        {!loading && !error && candles.length > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-fg-dim">
            {candles.length} bars · {TIMEFRAME_SECONDS[timeframe] / 60}m
          </div>
        )}
      </div>
    </div>
  )
}

function Ohlc({ label, v, color }: { label: string; v: string; color?: string }) {
  return (
    <span>
      <span className="text-fg-dim">{label} </span>
      <span style={{ color }}>{v}</span>
    </span>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-0/70 font-sans text-sm text-fg-muted">{children}</div>
  )
}

const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })
const toVolume = (c: Candle) => ({
  time: c.time as UTCTimestamp,
  value: c.volume,
  color: c.close >= c.open ? 'rgba(0,255,136,0.25)' : 'rgba(255,59,59,0.25)',
})
const toLine = (p: LinePoint) => ({ time: p.time as UTCTimestamp, value: p.value })
