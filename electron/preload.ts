import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { MsTraderApi } from '@shared/api'
import type { FeedState, Tick } from '@shared/types'

/**
 * Typed, minimal bridge exposed to the renderer as `window.mstrader`.
 * Only whitelisted channels are reachable; the renderer never sees ipcRenderer.
 */
const api: MsTraderApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  },
  account: {
    get: () => ipcRenderer.invoke(IPC.ACCOUNT_GET),
    set: (state) => ipcRenderer.invoke(IPC.ACCOUNT_SET, state),
    reset: (startingBalance) => ipcRenderer.invoke(IPC.TRADES_CLEAR, startingBalance),
  },
  trades: {
    list: (limit) => ipcRenderer.invoke(IPC.TRADES_LIST, limit),
    insert: (trade) => ipcRenderer.invoke(IPC.TRADES_INSERT, trade),
  },
  feed: {
    start: () => ipcRenderer.invoke(IPC.FEED_START),
    stop: () => ipcRenderer.invoke(IPC.FEED_STOP),
    state: () => ipcRenderer.invoke(IPC.FEED_STATE),
    history: (req) => ipcRenderer.invoke(IPC.FEED_HISTORY, req),
    onTick: (cb) => {
      const handler = (_e: Electron.IpcRendererEvent, ticks: Tick[]) => cb(ticks)
      ipcRenderer.on(IPC.TICK, handler)
      return () => ipcRenderer.removeListener(IPC.TICK, handler)
    },
    onState: (cb) => {
      const handler = (_e: Electron.IpcRendererEvent, state: FeedState) => cb(state)
      ipcRenderer.on(IPC.FEED_STATE_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.FEED_STATE_CHANGED, handler)
    },
  },
  notify: (payload) => ipcRenderer.invoke(IPC.NOTIFY, payload),
  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('mstrader', api)
