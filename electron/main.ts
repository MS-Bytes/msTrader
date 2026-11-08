import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { join } from 'node:path'
import { SYMBOLS } from '@shared/instruments'
import { IPC } from '@shared/ipc'
import type { AppSettings, HistoryRequest, NotificationPayload, PendingOrder, Position, Tick, TradeRecord } from '@shared/types'
import { TradeDatabase } from './database'
import { FeedManager } from './feeds/manager'

/**
 * Electron main process.
 *  - Owns the single BrowserWindow + system tray
 *  - Owns the SQLite connection (renderer never touches the DB directly)
 *  - Owns the market-data FeedManager and pushes ticks to the renderer
 *    in batched frames to keep the IPC channel and the UI thread smooth.
 */

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let db: TradeDatabase
let feed: FeedManager
let isQuitting = false

// ---- Tick batching ---------------------------------------------------------
// Feeds can emit hundreds of ticks/second; we coalesce them per animation
// frame (~16ms) and send one IPC message carrying only the latest tick per symbol.
const pendingTicks = new Map<string, Tick>()
let flushTimer: NodeJS.Timeout | null = null

function queueTick(tick: Tick): void {
  pendingTicks.set(tick.symbol, tick)
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (!mainWindow || mainWindow.isDestroyed() || pendingTicks.size === 0) return
    const batch = Array.from(pendingTicks.values())
    pendingTicks.clear()
    mainWindow.webContents.send(IPC.TICK, batch)
  }, 16)
}

// ---- Window ----------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'msTrader',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Open external links in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Minimise to tray on close (trading apps usually keep running in background).
  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  // 16x16 transparent PNG placeholder; replace with resources/tray.png in production.
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR42mNgoBfo7+//TyxmIFYDOqCKAWQpJsoAihQTbQBVFaMbgG4IRQZQrJjeBqAbQrEBFCseNQAAwQ4qPj6c1t0AAAAASUVORK5CYII=',
  )
  try {
    tray = new Tray(icon)
    tray.setToolTip('msTrader')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show msTrader', click: () => mainWindow?.show() },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            isQuitting = true
            app.quit()
          },
        },
      ]),
    )
    tray.on('click', () => (mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show()))
  } catch (err) {
    // Tray is optional (e.g. some Linux desktops without a status area)
    console.warn('Tray unavailable:', err)
    tray = null
  }
}

// ---- IPC -------------------------------------------------------------------

function registerIpc(): void {
  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, () => db.getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<AppSettings>) => {
    const next = db.setSettings(patch)
    feed.updateSettings(next)
    return next
  })

  // Account persistence
  ipcMain.handle(IPC.ACCOUNT_GET, () => db.getAccount())
  ipcMain.handle(IPC.ACCOUNT_SET, (_e, state: { balance: number; positions: Position[]; orders: PendingOrder[] }) => {
    db.setAccount(state)
    return true
  })

  // Trade history
  ipcMain.handle(IPC.TRADES_LIST, (_e, limit?: number) => db.listTrades(limit))
  ipcMain.handle(IPC.TRADES_INSERT, (_e, trade: TradeRecord) => {
    db.insertTrade(trade)
    return true
  })
  ipcMain.handle(IPC.TRADES_CLEAR, (_e, startingBalance: number) => {
    db.resetAccount(startingBalance)
    return true
  })

  // Market data
  ipcMain.handle(IPC.FEED_START, async () => feed.start(SYMBOLS))
  ipcMain.handle(IPC.FEED_STOP, () => {
    feed.stop()
    return true
  })
  ipcMain.handle(IPC.FEED_STATE, () => feed.getState())
  ipcMain.handle(IPC.FEED_HISTORY, (_e, req: HistoryRequest) => feed.history(req))

  // Native notifications
  ipcMain.handle(IPC.NOTIFY, (_e, payload: NotificationPayload) => {
    if (Notification.isSupported()) new Notification({ title: payload.title, body: payload.body, silent: true }).show()
    return true
  })

  // Window controls (for custom title bars)
  ipcMain.on(IPC.WINDOW_MINIMIZE, () => mainWindow?.minimize())
  ipcMain.on(IPC.WINDOW_MAXIMIZE, () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()))
  ipcMain.on(IPC.WINDOW_CLOSE, () => mainWindow?.close())
}

// ---- Lifecycle -------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.mstrader.app') // Windows toast attribution

    db = new TradeDatabase(join(app.getPath('userData'), 'mstrader.db'))
    feed = new FeedManager(db.getSettings())
    feed.onTick(queueTick)
    feed.onState((state) => {
      console.log(`[feed] ${state.source} ${state.status}${state.message ? ` – ${state.message}` : ''}`)
      mainWindow?.webContents.send(IPC.FEED_STATE_CHANGED, state)
    })

    registerIpc()
    createWindow()
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    feed?.stop()
    db?.close()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception in main:', err)
  })
}
