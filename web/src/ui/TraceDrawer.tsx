// Reasoning trace drawer (Coach, key D): the last checks as rows. What the vision model reported,
// which steps the fixed per-step checks counted, and where the time went.
import { motion } from 'framer-motion'
import { traceStats, useTrace, WEAVE_PROJECT, type TraceRow } from '../coach/trace'

const SHOW = 8

export function TraceDrawer({ steps }: { steps: number }) {
  const rows = useTrace()
  const last = rows.slice(-SHOW).reverse()
  const { checks, median } = traceStats(rows)
  const model = modelLabel(rows.at(-1)?.model)
  return (
    <motion.div
      className="pointer-events-auto absolute bottom-6 left-24 z-30 w-[1184px] rounded-[20px] border border-line-strong bg-surface shadow-[0_-24px_48px_rgba(0,0,0,0.5)] px-8 pb-5 pt-6"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
    >
      <div className="flex items-baseline gap-4">
        <h3 className="text-[22px] font-medium tracking-[-0.015em] text-ink">Reasoning trace</h3>
        <span className="font-mono text-[15px] text-ink-3">{model} observes · fixed checks per step · a step ticks after two agreeing readings</span>
        <span className="ml-auto flex items-center gap-2 font-mono text-[14px] text-ink-3">
          <kbd className="rounded-[5px] border border-line-strong px-1.5 text-ink-2">D</kbd> close
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[76px_minmax(0,1fr)_100px_184px_104px] gap-x-5 border-b border-line pb-2 font-mono text-[13px] uppercase tracking-[0.06em] text-ink-3">
        <span>Time</span>
        <span>What {model} saw</span>
        <span>Steps seen</span>
        <span>Reading</span>
        <span className="whitespace-nowrap text-right">Obs · check</span>
      </div>

      <div className="flex h-[328px] flex-col">
        {last.length === 0 && <p className="mt-6 font-mono text-[16px] text-ink-3">No checks yet. The trace fills as soon as a task is being coached.</p>}
        {last.map((r, i) => (
          <Row key={r.id} r={r} steps={steps} fresh={i === 0} />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 font-mono text-[15px] text-ink-3">
        <WeaveMark />
        <span>
          Traces in W&amp;B Weave · <span className="text-ink-2">{WEAVE_PROJECT}</span>
        </span>
        <span className="tnum ml-auto">
          {checks} {checks === 1 ? 'check' : 'checks'}
          {median != null && <> · median {(median / 1000).toFixed(1)} s round trip</>}
        </span>
      </div>
    </motion.div>
  )
}

function modelLabel(m?: string) {
  if (!m || m.includes('cosmos')) return 'Cosmos Reason'
  return m.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash')
}

function Row({ r, steps, fresh }: { r: TraceRow; steps: number; fresh: boolean }) {
  const t = new Date(r.at)
  const time = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
  return (
    <motion.div
      layout="position"
      className="grid h-[41px] grid-cols-[76px_minmax(0,1fr)_100px_184px_104px] items-center gap-x-5 border-b border-line"
      initial={fresh ? { opacity: 0, y: -6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <span className="tnum font-mono text-[15px] text-ink-3">{time}</span>
      <Observation o={r.observation} error={r.error} />
      <StepDots steps={steps} completed={r.completed} current={r.stepIndex} />
      <Verdict r={r} steps={steps} />
      <span className="tnum text-right font-mono text-[15px] text-ink-2">
        {r.error ? '–' : r.observeMs != null ? `${r.observeMs} · ${r.judgeMs ?? 0} ms` : `${Math.round(r.roundTripMs)} ms`}
      </span>
    </motion.div>
  )
}

const KEY: Record<string, string> = {
  left_bottle: 'left',
  mountain_dew_cap: 'Dew',
  coca_cola_cap: 'Coke',
  loose_caps_on_floor: 'floor',
  hands_touching_bottles: 'hands',
  bottom_row_cups: 'row 1',
  second_row_cups: 'row 2',
  top_row_cups: 'row 3',
  all_cups_in_one_nested_stack: 'nested',
  hidden_by_hands: 'hidden',
  base_plate_down: 'base',
  legs_on_base: 'legs',
  torso_on_legs: 'torso',
  head_or_helmet_on: 'head',
  staff_in_hand: 'staff',
}
const ORDER = Object.keys(KEY)

function value(v: unknown): string {
  if (v === true || v === 'true') return 'yes'
  if (v === false || v === 'false') return 'no'
  if (Array.isArray(v)) return v.length ? v.join('+') : 'none'
  return String(v ?? '–')
    .replace(/ cap on$/, ' cap')
    .replace(/^mountain dew$/, 'Dew')
    .replace(/^coca-cola$/, 'Coke')
}

function Observation({ o, error }: { o: TraceRow['observation']; error?: string }) {
  if (error) return <span className="truncate font-mono text-[15px] text-wip">{error}</span>
  if (!o) return <span className="font-mono text-[15px] text-ink-3">–</span>
  if (typeof o === 'string') return <span className="truncate font-mono text-[15px] text-ink-2">{o}</span>
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : 99)
  const keys = Object.keys(o).sort((a, b) => rank(a) - rank(b))
  return (
    <span className="flex min-w-0 items-baseline gap-x-3.5 overflow-hidden whitespace-nowrap font-mono text-[15px]">
      {keys.map((k) => {
        const v = value(o[k])
        return (
          <span key={k} className="shrink-0">
            <span className="text-ink-3">{KEY[k] ?? k.replace(/_/g, ' ')} </span>
            <span className={v === 'unclear' ? 'text-ink-3' : 'text-ink'}>{v}</span>
          </span>
        )
      })}
    </span>
  )
}

function StepDots({ steps, completed, current }: { steps: number; completed: number[]; current: number }) {
  return (
    <span className="flex items-center gap-[5px]">
      {Array.from({ length: steps }, (_, i) => {
        const on = completed.includes(i + 1)
        const cur = i === current
        return (
          <span
            key={i}
            className={`h-[14px] w-[14px] rounded-[3px] ${on ? 'bg-go/85' : cur ? 'border border-wip/80' : 'border border-line-strong'}`}
          />
        )
      })}
    </span>
  )
}

function Verdict({ r, steps }: { r: TraceRow; steps: number }) {
  if (r.error) return <span className="font-mono text-[15px] text-wip">unreachable</span>
  if (r.state === 'done')
    return (
      <span className="font-mono text-[15px] text-go">
        done
        {r.advanceTo != null && r.advanceTo >= steps
          ? ' · all steps'
          : r.advanceTo != null && r.advanceTo > r.stepIndex + 1
            ? ` · ahead to step ${r.advanceTo + 1}`
            : ''}
      </span>
    )
  if (r.state === 'mistake')
    return (
      <span className="truncate text-[15px] text-err" title={r.issue}>
        {r.issue ?? 'mistake'}
      </span>
    )
  return <span className="font-mono text-[15px] text-ink-3">working on step {r.stepIndex + 1}</span>
}

function WeaveMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M2 4 L5 12 L8 6 L11 12 L14 4" fill="none" stroke="#8C8A86" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
