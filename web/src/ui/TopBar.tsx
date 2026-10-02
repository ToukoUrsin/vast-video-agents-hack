import { useApp, type ScreenId } from '../app/context'

const TABS: Array<[ScreenId, string]> = [
  [1, 'Library'],
  [2, 'Map'],
  [3, 'Coach'],
  [4, 'Score'],
]

export function TopBar() {
  const { screen, setScreen } = useApp()
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-[112px] items-center justify-between px-24">
      <div className="flex items-center gap-3">
        <Mark />
        <span className="text-[24px] font-medium tracking-[-0.02em] text-ink">Understudy</span>
      </div>
      <nav className="pointer-events-auto flex items-center gap-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setScreen(id)}
            className={`relative flex items-center gap-2.5 rounded-full px-4 py-2 text-[17px] transition-colors ${
              screen === id ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            <span className="font-mono text-[14px] text-ink-3">{id}</span>
            {label}
            {screen === id && <span className="absolute inset-x-4 -bottom-1 h-px bg-ink/70" />}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <circle cx="14" cy="14" r="12.5" fill="none" stroke="rgba(244,242,238,0.35)" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="5" fill="#4BE38A" />
    </svg>
  )
}
