import type {
  AppSettings,
  Candle,
  FeedState,
  HistoryRequest,
  NotificationPayload,
  PendingOrder,
  Position,
  Tick,
  TradeRecord,
} from './types'

/**
 * Contract of the preload bridge exposed to the renderer as `window.mstrader`.
 * Shared so both sides are compiled against the same shape.
 */
export interface MsTraderApi {
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  account: {
    get(): Promise<{ balance: number; startingBalance: number; positions: Position[]; orders: PendingOrder[] }>
    set(state: { balance: number; positions: Position[]; orders: PendingOrder[] }): Promise<boolean>
    reset(startingBalance: number): Promise<boolean>
  }
  trades: {
    list(limit?: number): Promise<TradeRecord[]>
    insert(trade: TradeRecord): Promise<boolean>
  }
  feed: {
    start(): Promise<FeedState>
    stop(): Promise<boolean>
    state(): Promise<FeedState>
    history(req: HistoryRequest): Promise<Candle[]>
    onTick(cb: (ticks: Tick[]) => void): () => void
    onState(cb: (state: FeedState) => void): () => void
  }
  notify(payload: NotificationPayload): Promise<boolean>
  window: { minimize(): void; maximize(): void; close(): void }
  platform: 'win32' | 'darwin' | 'linux' | string
}
