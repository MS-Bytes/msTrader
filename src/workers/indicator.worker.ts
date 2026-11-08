import type { Candle } from '@shared/types'
import { computeIndicator, type IndicatorKind, type LinePoint } from '../lib/indicators'

/**
 * Web Worker: offloads indicator recalculation from the UI thread.
 * Each request carries the full candle array (structured-clone is cheap for
 * a few thousand bars) and returns all requested series in one message.
 */
export interface IndicatorRequest {
  reqId: number
  candles: Candle[]
  indicators: { id: string; kind: IndicatorKind; period: number }[]
}

export interface IndicatorResponse {
  reqId: number
  results: Record<string, LinePoint[]>
}

self.onmessage = (e: MessageEvent<IndicatorRequest>) => {
  const { reqId, candles, indicators } = e.data
  const results: Record<string, LinePoint[]> = {}
  for (const ind of indicators) {
    try {
      results[ind.id] = computeIndicator(ind.kind, candles, ind.period)
    } catch {
      results[ind.id] = []
    }
  }
  const res: IndicatorResponse = { reqId, results }
  self.postMessage(res)
}
