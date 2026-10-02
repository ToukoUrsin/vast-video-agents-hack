import { useEffect, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { useApp, useKeys } from '../app/context'
import { getClip, getCluster, tasks } from '../data'
import { demoResult, expertClipFor, fmt } from '../coach/scoring'
import type { SessionResult } from '../coach/types'
import { Thumb } from '../ui/Thumb'
import { ExpertClip } from '../ui/ExpertClip'
import { traceStats, useTrace, WEAVE_PROJECT } from '../coach/trace'

const params = new URLSearchParams(location.search)

export function Score() {
  const { session, setSession } = useApp()
  const [replay, setReplay] = useState(0)
  const pending = !!session && !session.scoredBy
  const result: SessionResult = session ?? demoResult(getCluster(params.get('task') ?? 'cap-swap') ?? tasks()[0])
  useKeys({ ' ': () => setReplay((r) => r + 1) })

  // live session: score + two feedback lines from the W&B-hosted LLM, local rule as fallback
  useEffect(() => {
    if (!session || session.scoredBy) return
    let cancelled = false
    scoreWithLlm(session).then((r) => !cancelled && setSession(r))
    return () => {
      cancelled = true
    }
  }, [session, setSession])

  return (
    <>
      <ScoreCard key={replay} result={result} isDemo={!session} pending={pending} />
      {session && <SessionFooter />}
    </>
  )
}

/** One line under the card: how many live checks the session took and how fast they were. */
function SessionFooter() {
  const { checks, median } = traceStats(useTrace())
  if (!checks) return null
  return (
    <motion.p
      className="tnum absolute bottom-12 left-24 font-mono text-[16px] text-ink-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 2.2, duration: 0.6 }}
    >
      <span className="text-ink-2">{checks} live checks</span>
      {median != null && (
        <>
          {' · '}median <span className="text-ink-2">{(median / 1000).toFixed(1)} s</span> per check
        </>
      )}
      {' · '}traces in W&amp;B Weave · {WEAVE_PROJECT}
    </motion.p>
  )
}

async function scoreWithLlm(s: SessionResult): Promise<SessionResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 9000)
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        task: s.task.label,
        steps: s.steps.map((r, i) => ({
          text: r.step.text,
          done: r.outcome !== 'missed',
          issue: s.mistakes.find((m) => m.stepIndex === i)?.issue ?? '',
          t: r.at != null ? Math.round(r.at) : null,
        })),
      }),
    })
    if (!res.ok) throw new Error(String(res.status))
    const j = (await res.json()) as { score?: number; feedback?: string[]; model?: string }
    if (typeof j.score !== 'number' || !j.feedback || j.feedback.length < 2) throw new Error('bad response')
    return { ...s, score: Math.round(j.score), feedback: [j.feedback[0], j.feedback[1]], scoredBy: 'llm', scoredModel: j.model }
  } catch {
    return { ...s, scoredBy: 'local' }
  } finally {
    clearTimeout(timer)
  }
}

const modelName = (m?: string) => (m ? m.split('/').pop()!.replace(/-Instruct$/, '').replace(/-/g, ' ') : 'LLM')

function ScoreCard({ result, isDemo, pending }: { result: SessionResult; isDemo: boolean; pending: boolean }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (pending) return
    const c = animate(0, result.score, { duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.25, onUpdate: (v) => setShown(Math.round(v)) })
    return () => c.stop()
  }, [result.score, pending])

  const [mountedAt] = useState(() => performance.now())
  const mountedFor = () => (performance.now() - mountedAt) / 1000
  const m = result.mistakes[0]
  const expert = m ? expertClipFor(result.task, m.stepIndex) : undefined
  const sloppy = library_sloppy(result.task.id)
  const lastStep = result.task.steps[result.task.steps.length - 1]
  const lastExpert = expertClipFor(result.task, result.task.steps.length - 1)
  const stepsDone = result.steps.filter((s) => s.outcome !== 'missed').length
  const base = 0.9

  return (
    <div className="absolute inset-0">
      {/* left */}
      <div className="absolute left-24 top-[184px] w-[680px]">
        <p className="font-mono text-[18px] text-ink-2">
          Score · {result.task.label}
          {isDemo && <span className="text-ink-3"> · sample session</span>}
        </p>
        {pending && (
          <div className="absolute left-0 top-[96px] flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-wip opacity-40" style={{ animationDuration: '1.6s' }} />
              <span className="relative h-2.5 w-2.5 rounded-full bg-wip" />
            </span>
            <span className="font-mono text-[20px] text-ink-2">Scoring with Llama 3.3 70B</span>
          </div>
        )}
        <div className="mt-2 flex items-baseline gap-4">
          <span className={`tnum text-[220px] font-medium leading-[0.92] tracking-[-0.06em] text-ink transition-opacity duration-300 ${pending ? 'opacity-0' : ''}`}>{shown}</span>
          <span className={`font-mono text-[30px] text-ink-3 ${pending ? 'opacity-0' : ''}`}>/100</span>
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
          className="mt-14 border-t border-line pt-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: pending ? 0 : 1, y: pending ? 10 : 0 }}
          transition={{ delay: pending ? 0 : Math.max(0.6, base + result.steps.length * 0.16 + 0.9 - mountedFor()), type: 'spring', stiffness: 200, damping: 30 }}
        >
          <p className="font-mono text-[17px] text-ink-2">
            Feedback
            {result.scoredBy === 'llm' && <span className="text-ink-3"> · {modelName(result.scoredModel)} via W&amp;B</span>}
          </p>
          <p className="mt-4 text-[30px] leading-[1.35] tracking-[-0.015em] text-ink text-pretty">{result.feedback[0]}</p>
          <p className="mt-4 text-[26px] leading-[1.4] tracking-[-0.01em] text-ink-2 text-pretty">{result.feedback[1]}</p>
        </motion.div>
      </div>

      {/* right */}
      <div className="absolute left-[880px] right-24 top-[184px]">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[17px] text-ink-2">Steps</p>
          <p className="font-mono text-[15px] text-ink-3">when each step happened · 0 – {fmt(result.durationS)}</p>
        </div>
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
                <TimingBar
                  from={i === 0 ? 0 : (result.steps[i - 1].at ?? 0)}
                  to={r.at ?? 0}
                  total={Math.max(1, result.durationS)}
                  tone={ok ? 'go' : 'err'}
                  delay={base + i * 0.16 + 0.15}
                />
                <span className="tnum w-[72px] text-right font-mono text-[18px] text-ink-3">{r.at != null ? fmt(r.at) : '–'}</span>
              </motion.div>
            )
          })}
        </div>

        {!m && result.finalFrameUrl && (
          <motion.div
            className="mt-12"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: base + result.steps.length * 0.16 + 0.3, type: 'spring', stiffness: 220, damping: 30 }}
          >
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[17px] text-go">Finished · {fmt(result.durationS)} · no corrections</p>
              <p className="font-mono text-[17px] text-ink-3">Your finish vs expert</p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Frame label={`You · ${fmt(result.durationS)}`} tone="go">
                <img src={result.finalFrameUrl} className="absolute inset-0 h-full w-full object-cover" />
              </Frame>
              <Frame label={`Expert · ${lastExpert?.take_label ?? 'best take'}`} tone="go">
                <ExpertClip clip={lastExpert} start={lastStep.expert_start_s} end={lastStep.expert_end_s} poster={lastStep.expert_poster_url} variant={result.task.steps.length} className="absolute inset-0" />
              </Frame>
            </div>
          </motion.div>
        )}

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
                  <img src={m.frameUrl} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <Thumb clip={sloppy} className="absolute inset-0" />
                )}
              </Frame>
              <Frame label={`Expert · ${expert?.take_label ?? 'best take'} · ${fmt(result.task.steps[m.stepIndex].expert_start_s)}`} tone="go">
                <ExpertClip clip={expert} start={result.task.steps[m.stepIndex].expert_start_s} end={result.task.steps[m.stepIndex].expert_end_s} poster={result.task.steps[m.stepIndex].expert_poster_url} variant={m.stepIndex + 1} className="absolute inset-0" />
              </Frame>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

function library_sloppy(taskId: string) {
  const ids: Record<string, string> = { 'cap-swap': 'ours-caps-3', 'cup-pyramid': 'ours-cups-3', 'vast-astronaut': 'ours-astro-3' }
  return getClip(ids[taskId] ?? '')
}

/** Where in the session a step happened, on a shared 0..total axis. */
function TimingBar({ from, to, total, tone, delay }: { from: number; to: number; total: number; tone: 'go' | 'err'; delay: number }) {
  const left = Math.min(1, from / total)
  const width = Math.max(0.012, Math.min(1, (to - from) / total))
  return (
    <div className="relative h-[6px] w-[200px] shrink-0 rounded-full bg-white/[0.06]">
      <motion.div
        className={`absolute inset-y-0 rounded-full ${tone === 'go' ? 'bg-go/70' : 'bg-err/80'}`}
        style={{ left: `${left * 100}%`, transformOrigin: 'left' }}
        initial={{ width: 0 }}
        animate={{ width: `${width * 100}%` }}
        transition={{ delay, duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
      />
    </div>
  )
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
