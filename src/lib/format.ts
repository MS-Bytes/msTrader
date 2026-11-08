import { getInstrument } from '@shared/instruments'

export function fmtPrice(symbol: string, price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '—'
  return price.toFixed(getInstrument(symbol).precision)
}

export function fmtMoney(v: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (opts.sign) return v > 0 ? `+$${abs}` : v < 0 ? `-$${abs}` : `$${abs}`
  return v < 0 ? `-$${abs}` : `$${abs}`
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false })
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour12: false })}`
}

export function fmtLots(l: number): string {
  return l.toFixed(2)
}

export function pips(symbol: string, diff: number): string {
  const inst = getInstrument(symbol)
  return (diff / inst.pipSize).toFixed(1)
}

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
