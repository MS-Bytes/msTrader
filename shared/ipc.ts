/** IPC channel names. Single source of truth for main, preload and renderer. */
export const IPC = {
  // Renderer -> Main (invoke/handle)
  FEED_START: 'feed:start',
  FEED_STOP: 'feed:stop',
  FEED_STATE: 'feed:state',
  FEED_HISTORY: 'feed:history',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  TRADES_LIST: 'trades:list',
  TRADES_INSERT: 'trades:insert',
  TRADES_CLEAR: 'trades:clear',
  ACCOUNT_GET: 'account:get',
  ACCOUNT_SET: 'account:set',
  NOTIFY: 'app:notify',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Main -> Renderer (push)
  TICK: 'feed:tick',
  FEED_STATE_CHANGED: 'feed:state-changed',
} as const
