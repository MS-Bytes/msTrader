import { create } from 'zustand'
import type { AppSettings, ThemeMode } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { getBridge } from '../services/bridge'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<AppSettings>): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  async load() {
    try {
      const settings = await getBridge().settings.get()
      set({ settings, loaded: true })
      applyTheme(settings.theme)
    } catch (err) {
      console.error('Failed to load settings', err)
      set({ loaded: true })
    }
  },

  async update(patch) {
    const optimistic = { ...get().settings, ...patch }
    set({ settings: optimistic })
    if (patch.theme) applyTheme(patch.theme)
    try {
      const saved = await getBridge().settings.set(patch)
      set({ settings: saved })
    } catch (err) {
      console.error('Failed to persist settings', err)
    }
  },
}))

let mediaQuery: MediaQueryList | null = null
let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null

/** Applies the `dark` class on <html>; 'auto' follows the OS preference live. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  if (mediaQuery && mediaHandler) mediaQuery.removeEventListener('change', mediaHandler)
  const setDark = (dark: boolean) => root.classList.toggle('dark', dark)
  if (mode === 'auto') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    setDark(mediaQuery.matches)
    mediaHandler = (e) => setDark(e.matches)
    mediaQuery.addEventListener('change', mediaHandler)
  } else {
    setDark(mode === 'dark')
  }
}
