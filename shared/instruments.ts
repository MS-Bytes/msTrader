import type { Instrument } from './types'

/**
 * Master instrument table. All provider-specific ticker differences are
 * resolved here, so the rest of the app only ever sees the canonical symbol.
 *
 * Contract sizes and leverage mirror common retail CFD/FX broker conventions.
 */
export const INSTRUMENTS: Instrument[] = [
  // ---- Forex majors ------------------------------------------------------
  fx('EURUSD', 'Euro / US Dollar', 'EUR', 'USD', 0.0001, 5, 'EUR_USD', 'EURUSD=X', 0.8),
  fx('GBPUSD', 'British Pound / US Dollar', 'GBP', 'USD', 0.0001, 5, 'GBP_USD', 'GBPUSD=X', 1.2),
  fx('USDJPY', 'US Dollar / Japanese Yen', 'USD', 'JPY', 0.01, 3, 'USD_JPY', 'USDJPY=X', 1.0),
  fx('AUDUSD', 'Australian Dollar / US Dollar', 'AUD', 'USD', 0.0001, 5, 'AUD_USD', 'AUDUSD=X', 1.0),
  fx('USDCAD', 'US Dollar / Canadian Dollar', 'USD', 'CAD', 0.0001, 5, 'USD_CAD', 'USDCAD=X', 1.5),
  fx('NZDUSD', 'New Zealand Dollar / US Dollar', 'NZD', 'USD', 0.0001, 5, 'NZD_USD', 'NZDUSD=X', 1.5),
  fx('USDCHF', 'US Dollar / Swiss Franc', 'USD', 'CHF', 0.0001, 5, 'USD_CHF', 'USDCHF=X', 1.5),

  // ---- Commodities -------------------------------------------------------
  {
    symbol: 'XAUUSD',
    name: 'Gold / US Dollar',
    assetClass: 'COMMODITY',
    baseCurrency: 'XAU',
    quoteCurrency: 'USD',
    pipSize: 0.01,
    precision: 2,
    contractSize: 100, // troy oz
    leverage: 20,
    commissionPerLot: 0,
    typicalSpreadPips: 25,
    providers: { oanda: 'XAU_USD', yahoo: 'GC=F' },
  },
  {
    symbol: 'XAGUSD',
    name: 'Silver / US Dollar',
    assetClass: 'COMMODITY',
    baseCurrency: 'XAG',
    quoteCurrency: 'USD',
    pipSize: 0.001,
    precision: 3,
    contractSize: 5000, // troy oz
    leverage: 20,
    commissionPerLot: 0,
    typicalSpreadPips: 25,
    providers: { oanda: 'XAG_USD', yahoo: 'SI=F' },
  },
  {
    symbol: 'USOIL',
    name: 'WTI Crude Oil',
    assetClass: 'COMMODITY',
    baseCurrency: 'WTI',
    quoteCurrency: 'USD',
    pipSize: 0.01,
    precision: 3,
    contractSize: 1000, // barrels
    leverage: 10,
    commissionPerLot: 0,
    typicalSpreadPips: 3,
    providers: { oanda: 'WTICO_USD', yahoo: 'CL=F' },
  },
  {
    symbol: 'NG',
    name: 'Natural Gas',
    assetClass: 'COMMODITY',
    baseCurrency: 'NATGAS',
    quoteCurrency: 'USD',
    pipSize: 0.001,
    precision: 3,
    contractSize: 10000, // MMBtu
    leverage: 10,
    commissionPerLot: 0,
    typicalSpreadPips: 5,
    providers: { oanda: 'NATGAS_USD', yahoo: 'NG=F' },
  },
]

function fx(
  symbol: string,
  name: string,
  base: string,
  quote: string,
  pipSize: number,
  precision: number,
  oanda: string,
  yahoo: string,
  typicalSpreadPips: number,
): Instrument {
  return {
    symbol,
    name,
    assetClass: 'FOREX',
    baseCurrency: base,
    quoteCurrency: quote,
    pipSize,
    precision,
    contractSize: 100_000,
    leverage: 30,
    commissionPerLot: 7, // $7 round-turn per standard lot (typical ECN/raw account)
    typicalSpreadPips,
    providers: { oanda, yahoo },
  }
}

export const INSTRUMENT_MAP: Record<string, Instrument> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.symbol, i]),
)

export const SYMBOLS = INSTRUMENTS.map((i) => i.symbol)

export function getInstrument(symbol: string): Instrument {
  const inst = INSTRUMENT_MAP[symbol]
  if (!inst) throw new Error(`Unknown instrument: ${symbol}`)
  return inst
}

/** Reverse lookup: provider ticker -> canonical symbol. */
export function fromProviderSymbol(provider: 'oanda' | 'yahoo', ticker: string): string | undefined {
  return INSTRUMENTS.find((i) => i.providers[provider] === ticker)?.symbol
}
