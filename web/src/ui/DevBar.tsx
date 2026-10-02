import { useApp } from '../app/context'

const ACTIONS: Record<number, Array<[string, string]>> = {
  1: [[' ', 'Space · start ingest'], ['r', 'R · reset']],
  2: [[' ', 'Space · cluster'], ['escape', 'Esc · close panel'], ['r', 'R · regrid']],
  3: [[' ', 'Space · start'], ['n', 'N · step done'], ['m', 'M · mistake'], ['r', 'R · reset']],
  4: [[' ', 'Space · replay']],
}

/** Rehearsal controls, only with ?dev. */
export function DevBar() {
  const { dev, screen, keys } = useApp()
  if (!dev) return null
  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-2 py-1.5">
      <span className="px-2 font-mono text-[13px] text-ink-3">dev</span>
      {ACTIONS[screen].map(([k, label]) => (
        <button key={k} onClick={() => keys.current[k]?.()} className="rounded-full px-3 py-1 font-mono text-[13px] text-ink-2 hover:bg-white/5 hover:text-ink">
          {label}
        </button>
      ))}
    </div>
  )
}
