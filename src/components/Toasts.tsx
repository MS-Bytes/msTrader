import { cls } from '../lib/format'
import { useUiStore } from '../store/uiStore'

const tone = {
  success: 'border-bull/50',
  error: 'border-bear/60',
  warn: 'border-warn/60',
  info: 'border-accent/50',
}
const bar = { success: 'bg-bull', error: 'bg-bear', warn: 'bg-warn', info: 'bg-accent' }

/** In-app toast stack (bottom-right). Native OS notifications are sent separately. */
export default function Toasts() {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cls('pointer-events-auto flex cursor-pointer overflow-hidden rounded border bg-surface-2 shadow-xl animate-slide-in', tone[t.kind])}
        >
          <div className={cls('w-1 shrink-0', bar[t.kind])} />
          <div className="min-w-0 p-2.5">
            <div className="font-sans text-xs font-semibold text-fg">{t.title}</div>
            {t.body && <div className="mt-0.5 break-words font-mono text-[11px] text-fg-muted">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
