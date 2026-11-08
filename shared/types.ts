/**
 * Types shared between the Electron main process and the React renderer.
 * Keep this file free of runtime imports so both tsconfigs can include it.
 */

export type Side = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP'
export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED'
export type AssetClass = 'FOREX' | 'COMMODITY'
export type FeedSource = 'OANDA' | 'YAHOO' | 'SIM' | 'NONE'
export type FeedStatus = 'connecting' | 'live' | 'degraded' | 'offline'
export type ThemeMode = 'dark' | 'light' | 'auto'

export interface Instrument {
  /** Canonical symbol used throughout the app (e.g. EURUSD, XAUUSD) */
  symbol: string
  name: string
  assetClass: AssetClass
  /** Currency the price is quoted in (determines P&L conversion) */
  quoteCurrency: string
  baseCurrency: string
  /** Smallest meaningful price move (0.0001 for most FX, 0.01 for JPY/Gold) */
  pipSize: number
  /** Decimal places to display */
  precision: number
  /** Units of base asset per 1.0 standard lot */
  contractSize: number
  /** Maximum leverage (margin = notional / leverage) */
  leverage: number
  /** Round-turn commission in USD per standard lot */
  commissionPerLot: number
  /** Typical spread in pips, used by the simulator and as a sanity floor */
  typicalSpreadPips: number
  /** Provider-specific ticker mapping */
  providers: {
    oanda: string
    yahoo: string
  }
}

export interface Tick {
  symbol: string
  bid: number
  ask: number
  /** Epoch ms */
  time: number
  source: FeedSource
}

export interface Candle {
  /** Epoch seconds (what lightweight-charts expects for UTCTimestamp) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
}

export interface Position {
  id: string
  symbol: string
  side: Side
  lots: number
  units: number
  entryPrice: number
  /** Live mark price (bid for longs, ask for shorts) */
  currentPrice: number
  stopLoss: number | null
  takeProfit: number | null
  openedAt: number
  commission: number
  /** Realised slippage at fill, in price units */
  slippage: number
  spreadCost: number
  unrealizedPnl: number
  margin: number
}

export interface PendingOrder {
  id: string
  symbol: string
  side: Side
  type: Exclude<OrderType, 'MARKET'>
  lots: number
  price: number
  stopLoss: number | null
  takeProfit: number | null
  createdAt: number
  status: OrderStatus
}

export type CloseReason = 'MANUAL' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'MARGIN_CALL'

export interface TradeRecord {
  id: string
  symbol: string
  side: Side
  lots: number
  units: number
  entryPrice: number
  exitPrice: number
  stopLoss: number | null
  takeProfit: number | null
  openedAt: number
  closedAt: number
  commission: number
  slippage: number
  spreadCost: number
  grossPnl: number
  netPnl: number
  closeReason: CloseReason
}

export interface AccountSnapshot {
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  marginLevel: number | null
  unrealizedPnl: number
}

export interface AppSettings {
  theme: ThemeMode
  soundAlerts: boolean
  defaultLots: number
  startingBalance: number
  oandaApiKey: string
  oandaAccountId: string
  oandaEnv: 'practice' | 'live'
  /** Yahoo polling interval in ms when in fallback mode */
  pollIntervalMs: number
  /** Allow synthetic random-walk feed when every network source is unavailable */
  allowSimulatedFeed: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  soundAlerts: true,
  defaultLots: 0.1,
  startingBalance: 10_000,
  oandaApiKey: '',
  oandaAccountId: '',
  oandaEnv: 'practice',
  pollIntervalMs: 2000,
  allowSimulatedFeed: true,
}

export interface FeedState {
  source: FeedSource
  status: FeedStatus
  message?: string
  lastTickAt: number | null
}

export interface HistoryRequest {
  symbol: string
  timeframe: Timeframe
  /** Number of candles requested */
  count: number
}

export interface NotificationPayload {
  title: string
  body: string
}
