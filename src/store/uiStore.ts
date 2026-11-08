import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'info' | 'warn'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  body?: string
}

type BottomTab = 'positions' | 'orders' | 'history'

interface UiState {
  toasts: Toast[]
  settingsOpen: boolean
  bottomTab: BottomTab
  bottomCollapsed: boolean
  leftCollapsed: boolean
  rightCollapsed: boolean
  pushToast(kind: ToastKind, title: string, body?: string): void
  dismissToast(id: number): void
  setSettingsOpen(open: boolean): void
  setBottomTab(tab: BottomTab): void
  toggle(panel: 'left' | 'right' | 'bottom'): void
}

let nextId = 1

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  settingsOpen: false,
  bottomTab: 'positions',
  bottomCollapsed: false,
  leftCollapsed: false,
  rightCollapsed: false,

  pushToast(kind, title, body) {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, kind, title, body }].slice(-5) })
    setTimeout(() => get().dismissToast(id), 4500)
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },

  setBottomTab(tab) {
    set({ bottomTab: tab, bottomCollapsed: false })
  },

  toggle(panel) {
    if (panel === 'left') set({ leftCollapsed: !get().leftCollapsed })
    else if (panel === 'right') set({ rightCollapsed: !get().rightCollapsed })
    else set({ bottomCollapsed: !get().bottomCollapsed })
  },
}))
