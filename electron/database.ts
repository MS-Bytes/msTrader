import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, PendingOrder, Position, TradeRecord } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

const ACCOUNT_ID = 1

/**
 * Thin repository over better-sqlite3. All calls are synchronous (fast, local)
 * and wrapped in try/catch at the IPC boundary.
 */
export class TradeDatabase {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.applySchema()
  }

  private applySchema(): void {
    const schema = readFileSync(resolveSchemaPath(), 'utf8')
    this.db.exec(schema)
  }

  // ---- Settings -----------------------------------------------------------

  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const stored: Partial<AppSettings> = {}
    for (const row of rows) {
      try {
        ;(stored as Record<string, unknown>)[row.key] = JSON.parse(row.value)
      } catch {
        /* ignore corrupt entries, fall back to default */
      }
    }
    return { ...DEFAULT_SETTINGS, ...stored }
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    const upsert = this.db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    const now = Date.now()
    const tx = this.db.transaction((entries: [string, unknown][]) => {
      for (const [k, v] of entries) upsert.run(k, JSON.stringify(v), now)
    })
    tx(Object.entries(patch))
    return this.getSettings()
  }

  // ---- Account ------------------------------------------------------------

  getAccount(): { balance: number; startingBalance: number; positions: Position[]; orders: PendingOrder[] } {
    const acct = this.db
      .prepare('SELECT balance, starting_balance FROM accounts WHERE id = ?')
      .get(ACCOUNT_ID) as { balance: number; starting_balance: number }
    const positions = (
      this.db.prepare('SELECT payload FROM open_positions WHERE account_id = ?').all(ACCOUNT_ID) as { payload: string }[]
    ).map((r) => JSON.parse(r.payload) as Position)
    const orders = (
      this.db.prepare('SELECT payload FROM pending_orders WHERE account_id = ?').all(ACCOUNT_ID) as { payload: string }[]
    ).map((r) => JSON.parse(r.payload) as PendingOrder)
    return { balance: acct.balance, startingBalance: acct.starting_balance, positions, orders }
  }

  /** Atomically persist balance + open positions + pending orders. */
  setAccount(state: { balance: number; positions: Position[]; orders: PendingOrder[] }): void {
    const now = Date.now()
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?').run(state.balance, now, ACCOUNT_ID)
      this.db.prepare('DELETE FROM open_positions WHERE account_id = ?').run(ACCOUNT_ID)
      this.db.prepare('DELETE FROM pending_orders WHERE account_id = ?').run(ACCOUNT_ID)
      const insPos = this.db.prepare(
        'INSERT INTO open_positions (id, account_id, payload, updated_at) VALUES (?, ?, ?, ?)',
      )
      const insOrd = this.db.prepare(
        'INSERT INTO pending_orders (id, account_id, payload, updated_at) VALUES (?, ?, ?, ?)',
      )
      for (const p of state.positions) insPos.run(p.id, ACCOUNT_ID, JSON.stringify(p), now)
      for (const o of state.orders) insOrd.run(o.id, ACCOUNT_ID, JSON.stringify(o), now)
    })
    tx()
  }

  resetAccount(startingBalance: number): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE accounts SET balance = ?, starting_balance = ?, updated_at = ? WHERE id = ?')
        .run(startingBalance, startingBalance, Date.now(), ACCOUNT_ID)
      this.db.prepare('DELETE FROM open_positions WHERE account_id = ?').run(ACCOUNT_ID)
      this.db.prepare('DELETE FROM pending_orders WHERE account_id = ?').run(ACCOUNT_ID)
      this.db.prepare('DELETE FROM trades WHERE account_id = ?').run(ACCOUNT_ID)
    })
    tx()
  }

  // ---- Trades -------------------------------------------------------------

  insertTrade(t: TradeRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO trades
         (id, account_id, symbol, side, lots, units, entry_price, exit_price, stop_loss, take_profit,
          opened_at, closed_at, commission, slippage, spread_cost, gross_pnl, net_pnl, close_reason)
         VALUES (@id, @accountId, @symbol, @side, @lots, @units, @entryPrice, @exitPrice, @stopLoss, @takeProfit,
          @openedAt, @closedAt, @commission, @slippage, @spreadCost, @grossPnl, @netPnl, @closeReason)`,
      )
      .run({ ...t, accountId: ACCOUNT_ID })
  }

  listTrades(limit = 500): TradeRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, symbol, side, lots, units, entry_price, exit_price, stop_loss, take_profit, opened_at, closed_at,
                commission, slippage, spread_cost, gross_pnl, net_pnl, close_reason
         FROM trades WHERE account_id = ? ORDER BY closed_at DESC LIMIT ?`,
      )
      .all(ACCOUNT_ID, limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      symbol: r.symbol as string,
      side: r.side as TradeRecord['side'],
      lots: r.lots as number,
      units: r.units as number,
      entryPrice: r.entry_price as number,
      exitPrice: r.exit_price as number,
      stopLoss: (r.stop_loss as number | null) ?? null,
      takeProfit: (r.take_profit as number | null) ?? null,
      openedAt: r.opened_at as number,
      closedAt: r.closed_at as number,
      commission: r.commission as number,
      slippage: r.slippage as number,
      spreadCost: r.spread_cost as number,
      grossPnl: r.gross_pnl as number,
      netPnl: r.net_pnl as number,
      closeReason: r.close_reason as TradeRecord['closeReason'],
    }))
  }

  close(): void {
    this.db.close()
  }
}

/** Schema ships in /db for dev and is copied to resources/db when packaged. */
function resolveSchemaPath(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'db', 'schema.sql'),
    join(app.getAppPath(), 'db', 'schema.sql'),
    join(__dirname, '..', '..', 'db', 'schema.sql'),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error(`schema.sql not found. Looked in: ${candidates.join(', ')}`)
  return found
}
