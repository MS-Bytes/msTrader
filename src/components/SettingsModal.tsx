import { useEffect, useState } from 'react'
import type { AppSettings, ThemeMode } from '@shared/types'
import { cls } from '../lib/format'
import { useSettingsStore } from '../store/settingsStore'
import { useTradeStore } from '../store/tradeStore'
import { useUiStore } from '../store/uiStore'

/** Settings modal: sound, theme, default lot, data-source keys, account reset. */
export default function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen)
  const close = () => useUiStore.getState().setSettingsOpen(false)
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const resetAccount = useTradeStore((s) => s.resetAccount)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(settings)
      setConfirmReset(false)
    }
  }, [open, settings])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    await update(draft)
    close()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-line bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-sans text-sm font-semibold text-fg">Settings</h2>
          <button onClick={close} className="text-fg-muted hover:text-fg">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 font-sans text-xs">
          <Section title="Trading">
            <Row label="Default lot size">
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={draft.defaultLots}
                onChange={(e) => set('defaultLots', Number(e.target.value))}
                className={input}
              />
            </Row>
            <Row label="Sound alerts on execution">
              <Toggle checked={draft.soundAlerts} onChange={(v) => set('soundAlerts', v)} />
            </Row>
          </Section>

          <Section title="Appearance">
            <Row label="Theme">
              <div className="flex gap-0.5 rounded bg-surface-2 p-0.5">
                {(['dark', 'light', 'auto'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => set('theme', m)}
                    className={cls('rounded px-3 py-1 capitalize', draft.theme === m ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg')}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          <Section title="Market data" hint="OANDA v20 demo streams tick-level prices for free. Leave blank to use the Yahoo Finance fallback (delayed).">
            <Row label="OANDA environment">
              <select value={draft.oandaEnv} onChange={(e) => set('oandaEnv', e.target.value as AppSettings['oandaEnv'])} className={input}>
                <option value="practice">Practice (demo)</option>
                <option value="live">Live (read-only pricing)</option>
              </select>
            </Row>
            <Row label="OANDA API token">
              <input type="password" value={draft.oandaApiKey} onChange={(e) => set('oandaApiKey', e.target.value)} className={input} autoComplete="off" />
            </Row>
            <Row label="OANDA account ID">
              <input value={draft.oandaAccountId} onChange={(e) => set('oandaAccountId', e.target.value)} className={input} placeholder="101-001-1234567-001" />
            </Row>
            <Row label="Fallback poll interval (ms)">
              <input type="number" min={1000} step={500} value={draft.pollIntervalMs} onChange={(e) => set('pollIntervalMs', Number(e.target.value))} className={input} />
            </Row>
            <Row label="Allow simulated feed when offline">
              <Toggle checked={draft.allowSimulatedFeed} onChange={(v) => set('allowSimulatedFeed', v)} />
            </Row>
          </Section>

          <Section title="Danger zone">
            <Row label="Reset paper account">
              {confirmReset ? (
                <div className="flex items-center gap-2">
                  <input type="number" min={100} step={100} value={draft.startingBalance} onChange={(e) => set('startingBalance', Number(e.target.value))} className={cls(input, 'w-28')} />
                  <button
                    onClick={async () => {
                      await update({ startingBalance: draft.startingBalance })
                      await resetAccount(draft.startingBalance)
                      setConfirmReset(false)
                    }}
                    className="rounded bg-bear px-3 py-1 font-semibold text-white"
                  >
                    Confirm
                  </button>
                  <button onClick={() => setConfirmReset(false)} className="text-fg-muted hover:text-fg">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmReset(true)} className="rounded border border-bear/50 px-3 py-1 text-bear hover:bg-bear/10">
                  Reset…
                </button>
              )}
            </Row>
          </Section>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button onClick={close} className="rounded px-3 py-1.5 font-sans text-xs text-fg-muted hover:text-fg">Cancel</button>
          <button onClick={save} className="rounded bg-accent px-4 py-1.5 font-sans text-xs font-semibold text-black hover:brightness-110">Save</button>
        </div>
      </div>
    </div>
  )
}

const input = 'w-48 max-w-full rounded border border-line bg-surface-0 px-2 py-1 font-mono text-xs text-fg focus:border-accent focus:outline-none'

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-dim">{title}</h3>
      {hint && <p className="mb-2 text-[11px] text-fg-muted">{hint}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-fg">{label}</span>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cls('relative h-5 w-9 rounded-full transition', checked ? 'bg-bull' : 'bg-surface-3')}
    >
      <span className={cls('absolute top-0.5 h-4 w-4 rounded-full bg-white transition', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}
