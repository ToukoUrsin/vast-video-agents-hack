import { useEffect, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { useApp, useKeys } from '../app/context'
import { getClip, getCluster, tasks } from '../data'
import { demoResult, expertClipFor, fmt } from '../coach/scoring'
import type { SessionResult } from '../coach/types'
import { Thumb } from '../ui/Thumb'

const params = new URLSearchParams(location.search)

export function Score() {
  const { session } = useApp()
  const [replay, setReplay] = useState(0)
  const result: SessionResult = session ?? demoResult(getCluster(params.get('task') ?? 'packing-box') ?? tasks()[0])
  useKeys({ ' ': () => setReplay((r) => r + 1) })
  return <ScoreCard key={replay} result={result} isDemo={!session} />
}

function ScoreCard({ result, isDemo }: { result: SessionResult; isDemo: boolean }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const c = animate(0, result.score, { duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.25, onUpdate: (v) => setShown(Math.round(v)) })
    return () => c.stop()
  }, [result.score])

  const m = result.mistakes[0]
  const expert = m ? expertClipFor(result.task, m.stepIndex) : undefined
  const sloppy = library_sloppy(result.task.id)
  const stepsDone = result.steps.filter((s) => s.outcome !== 'missed').length
  const base = 0.9

  return (
    <div className="absolute inset-0">
      {/* left */}
      <div className="absolute left-24 top-[152px] w-[680px]">
        <p className="font-mono text-[18px] text-ink-2">
          Score · {result.task.label}
          {isDemo && <span className="text-ink-3"> · sample session</span>}
        </p>
        <div className="mt-2 flex items-baseline gap-4">
          <span className="tnum text-[220px] font-medium leading-[0.92] tracking-[-0.06em] text-ink">{shown}</span>
          <span className="font-mono text-[30px] text-ink-3">/100</span>
        </div>
        <motion.div
          className="mt-8 flex gap-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.5 }}
        >
          <Stat label="Steps" value={`${stepsDone}/${result.steps.length}`} />
          <Stat label="Corrections" value={String(result.mistakes.length)} tone={result.mistakes.length ? 'err' : undefined} />
          <Stat label="Time" value={fmt(result.durationS)} />
        </motion.div>

        <motion.div
          className="mt-16 border-t border-line pt-7"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: base + result.steps.length * 0.16 + 0.9, type: 'spring', stiffness: 200, damping: 30 }}
        >
          <p className="font-mono text-[17px] text-ink-2">Feedback</p>
          <p className="mt-3 text-[26px] leading-[1.4] tracking-[-0.01em] text-ink">{result.feedback[0]}</p>
          <p className="mt-2 text-[26px] leading-[1.4] tracking-[-0.01em] text-ink-2">{result.feedback[1]}</p>
        </motion.div>
      </div>

      {/* right */}
      <div className="absolute left-[880px] right-24 top-[152px]">
        <p className="font-mono text-[17px] text-ink-2">Steps</p>
        <div className="mt-3">
          {result.steps.map((r, i) => {
            const ok = r.outcome === 'done'
            return (
              <motion.div
                key={r.step.id}
                className="flex h-[60px] items-center gap-5 border-t border-line"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: base + i * 0.16, type: 'spring', stiffness: 320, damping: 28 }}
              >
                <Mark ok={ok} delay={base + i * 0.16 + 0.1} />
                <span className={`flex-1 text-[24px] tracking-[-0.01em] ${ok ? 'text-ink' : 'text-ink'}`}>{r.step.text}</span>
                {!ok && <span className="font-mono text-[16px] text-err">{r.outcome === 'fixed' ? 'fixed after prompt' : 'missed'}</span>}
                <span className="tnum w-[72px] text-right font-mono text-[18px] text-ink-3">{r.at != null ? fmt(r.at) : '–'}</span>
              </motion.div>
            )
          })}
        </div>

        {m && (
          <motion.div
            className="mt-12"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: base + result.steps.length * 0.16 + 0.3, type: 'spring', stiffness: 220, damping: 30 }}
          >
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[17px] text-err">
                Mistake · {fmt(m.at)} · step {m.stepIndex + 1}
              </p>
              <p className="font-mono text-[17px] text-ink-3">You vs expert</p>
            </div>
            <p className="mt-2 text-[24px] leading-[1.35] tracking-[-0.01em] text-ink">{m.issue}</p>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Frame label={`You · ${fmt(m.at)}`} tone="err">
                {m.frameUrl ? (
                  <img src={m.frameUrl} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
                ) : (
                  <Thumb clip={sloppy} className="absolute inset-0" />
                )}
              </Frame>
              <Frame label={`Expert · ${expert?.take_label ?? 'best take'} · ${fmt(result.task.steps[m.stepIndex].expert_start_s)}`} tone="go">
                <Thumb clip={expert} className="absolute inset-0" />
              </Frame>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

function library_sloppy(taskId: string) {
  const ids: Record<string, string> = { 'packing-box': 'ours-box-3', 'making-tea': 'ours-tea-3', 'safety-gear': 'ours-gear-3' }
  return getClip(ids[taskId] ?? '')
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'err' }) {
  return (
    <div>
      <div className="font-mono text-[16px] text-ink-3">{label}</div>
      <div className={`tnum mt-1 font-mono text-[32px] ${tone === 'err' ? 'text-err' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

function Frame({ label, tone, children }: { label: string; tone: 'err' | 'go'; children: React.ReactNode }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-[14px] border border-line bg-surface">
      {children}
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-stage/80 px-3 py-1">
        <span className={`h-1.5 w-1.5 rounded-full ${tone === 'err' ? 'bg-err' : 'bg-go'}`} />
        <span className="font-mono text-[14px] text-ink">{label}</span>
      </div>
    </div>
  )
}

function Mark({ ok, delay }: { ok: boolean; delay: number }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0">
      {ok ? (
        <motion.path
          d="M5 12.5 L10 17 L19 7"
          fill="none"
          stroke="#4BE38A"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay, duration: 0.35 }}
        />
      ) : (
        <motion.path
          d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5"
          fill="none"
          stroke="#FF5A4E"
          strokeWidth="2.4"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay, duration: 0.35 }}
        />
      )}
    </svg>
  )
}
