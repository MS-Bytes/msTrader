/**
 * Tiny WebAudio synth for execution alerts – no asset files needed.
 * Lazily creates the AudioContext on first use (browsers require a gesture).
 */
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function beep(freq: number, durationMs: number, startOffset = 0, type: OscillatorType = 'sine'): void {
  const ac = getCtx()
  if (!ac) return
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t0 = ac.currentTime + startOffset
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000)
  osc.connect(gain).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + durationMs / 1000 + 0.02)
}

export const sounds = {
  /** Rising two-tone: order filled */
  open(): void {
    beep(660, 90)
    beep(880, 120, 0.09)
  },
  /** Falling two-tone: position closed */
  close(): void {
    beep(880, 90)
    beep(560, 140, 0.09)
  },
  /** Harsh buzz: rejection / margin issue */
  error(): void {
    beep(220, 220, 0, 'square')
  },
  /** Soft tick: pending order placed */
  pending(): void {
    beep(520, 80, 0, 'triangle')
  },
}
