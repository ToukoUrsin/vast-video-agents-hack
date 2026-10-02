import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp, useKeys } from '../app/context'
import { getCluster, library, tasks } from '../data'
import type { Cluster } from '../data/types'
import { Thumb } from '../ui/Thumb'
import { HttpStepChecker, HttpTaskRecognizer, MockStepChecker, MockTaskRecognizer } from '../coach/checkers'
import { useCamera, useCoach, type CameraState } from '../coach/useCoach'
import type { CoachState } from '../coach/machine'
import { expertClipFor, fmt } from '../coach/scoring'
import { chime } from '../coach/media'
import { ExpertClip } from '../ui/ExpertClip'

const params = new URLSearchParams(location.search)
const VIDEO = { x: 96, y: 152, w: 1184, h: 666 }

export function Coach() {
  const { setSession } = useApp()
  const { videoRef, camera, retry } = useCamera()
  const task = getCluster(params.get('task') ?? 'lego-tower') ?? tasks()[0]
  // Live by default (Cosmos via our server). ?checker=mock = rehearsal: N / M drive the steps.
  const rehearsal = params.get('checker') === 'mock'
  const mock = useMemo(() => new MockStepChecker(), [])
  const checker = useMemo(() => (rehearsal ? mock : new HttpStepChecker()), [mock, rehearsal])
  const recognizer = useMemo(
    () => (rehearsal ? new MockTaskRecognizer(task, 1500) : new HttpTaskRecognizer((k) => getCluster(k) ?? tasks().find((t) => t.label.toLowerCase() === k.toLowerCase()))),
    [task, rehearsal],
  )
  const { state, start, reset, forceTask } = useCoach({
    video: videoRef,
    checker,
    recognizer,
    voice: !params.has('mute'),
    requiredDone: rehearsal ? 1 : 2,
  })
  const [forced, setForced] = useState(false)
  const [now, setNow] = useState(performance.now())

  useEffect(() => {
    if (state.phase === 'idle') return
    const id = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(id)
  }, [state.phase])

  // start watching on its own once the camera is live (the performer walks up silently)
  useEffect(() => {
    if (camera !== 'live' || state.phase !== 'idle') return
    const id = setTimeout(start, 1200)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, state.phase])

  // catch-up: tick several steps one by one, ~250 ms apart, each with its chime
  const shownIndex = useStaggered(state.phase === 'idle' ? 0 : state.stepIndex, 250)
  useEffect(() => {
    if (shownIndex > 0) chime('good')
  }, [shownIndex])

  useEffect(() => {
    if (state.result) setSession(state.result)
  }, [state.result, setSession])

  useKeys({
    ' ': () => state.phase === 'idle' && start(),
    r: () => {
      mock.clear()
      setForced(false)
      reset()
    },
    // presenter fallback if recognition is slow: pick the main demo task by hand
    t: () => {
      if (state.phase === 'idle' || state.phase === 'detecting') {
        setForced(true)
        forceTask(task)
      }
    },
    n: () => mock.push('done'),
    m: () => mock.push('mistake'),
  })

  const elapsed = state.phase === 'idle' ? 0 : (now - state.startedAt) / 1000
  const mistake = state.stepStatus === 'mistake'

  return (
    <div className="absolute inset-0">
      {/* video */}
      <div
        className="absolute overflow-hidden rounded-[20px] border border-line-strong bg-surface"
        style={{ left: VIDEO.x, top: VIDEO.y, width: VIDEO.w, height: VIDEO.h }}
      >
        <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
        {camera !== 'live' && <CameraEmpty state={camera} onRetry={retry} />}

        {/* chrome */}
        <div className="absolute left-6 top-6 flex items-center gap-2.5 rounded-full bg-stage/75 px-3.5 py-1.5">
          <span className={`h-2 w-2 rounded-full ${camera === 'live' ? 'bg-go' : 'bg-ink-3'}`} />
          <span className="font-mono text-[15px] text-ink">{camera === 'live' ? 'Live' : 'No camera'}</span>
          <span className="font-mono text-[15px] text-ink-3">· Camera 1</span>
        </div>
        {state.phase !== 'idle' && (
          <div className="tnum absolute right-6 top-6 rounded-full bg-stage/75 px-3.5 py-1.5 font-mono text-[15px] text-ink">{fmt(elapsed)}</div>
        )}

        {/* mistake edge */}
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-[20px]"
          animate={{ opacity: mistake ? 1 : 0 }}
          transition={{ duration: 0.35 }}
          style={{ boxShadow: 'inset 0 0 0 2px #FF5A4E, inset 0 0 22px rgba(120,10,0,0.45)' }}
        />

        {/* detecting progress */}
        <AnimatePresence>
          {state.phase === 'detecting' && !state.error && (
            <motion.div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5" exit={{ opacity: 0 }}>
              <motion.div className="h-full bg-wip" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 4, ease: 'linear' }} />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {mistake && state.task && <CorrectionCard key={state.stepIndex} state={state} />}
        </AnimatePresence>
      </div>

      {/* caption */}
      <div className="absolute flex h-[120px] items-start" style={{ left: VIDEO.x, top: VIDEO.y + VIDEO.h + 36, width: VIDEO.w }}>
        <AnimatePresence mode="wait">
          {state.utterance && (
            <motion.p
              key={state.utterance.id}
              className="flex items-baseline gap-4 text-[32px] leading-[1.3] tracking-[-0.01em] text-ink"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 400, damping: 36 }}
            >
              <span
                className={`shrink-0 font-mono text-[17px] ${state.utterance.tone === 'error' ? 'text-err' : state.utterance.tone === 'good' ? 'text-go' : 'text-ink-3'}`}
              >
                Coach
              </span>
              <span>{state.utterance.text}</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <Rail state={state} shownIndex={shownIndex} elapsed={elapsed} rehearsal={rehearsal} forced={forced} />

    </div>
  )
}

/** Follows `target` one step at a time so a multi-step jump reads as progress. Jumps down instantly. */
function useStaggered(target: number, ms: number) {
  const [shown, setShown] = useState(target)
  useEffect(() => {
    if (shown > target) setShown(target)
    else if (shown < target) {
      const id = setTimeout(() => setShown((v) => Math.min(target, v + 1)), ms)
      return () => clearTimeout(id)
    }
  }, [shown, target, ms])
  return shown
}

function CameraEmpty({ state, onRetry }: { state: CameraState; onRetry: () => void }) {
  if (state === 'pending')
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[18px] text-ink-3">Starting camera</span>
      </div>
    )
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg className="absolute inset-0 h-full w-full opacity-[0.5]" aria-hidden>
        <defs>
          <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.08)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>
      <div className="relative flex w-[520px] flex-col items-start">
        <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden>
          <rect x="1" y="5" width="40" height="30" rx="7" fill="none" stroke="#8C8A86" strokeWidth="2" />
          <path d="M41 16 L54 8 V32 L41 24" fill="none" stroke="#8C8A86" strokeWidth="2" strokeLinejoin="round" />
          <path d="M4 2 L52 38" stroke="#FF5A4E" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <h3 className="mt-7 text-[34px] font-medium tracking-[-0.02em]">{state === 'denied' ? 'Camera access is off' : 'No camera found'}</h3>
        <p className="mt-3 text-[20px] leading-[1.45] text-ink-2">
          {state === 'denied'
            ? 'Allow the camera for this page in the browser’s site settings, then try again.'
            : 'Connect a camera, then try again.'}
        </p>
        <button
          onClick={onRetry}
          className="pointer-events-auto mt-8 rounded-full border border-line-strong px-6 py-2.5 text-[18px] text-ink transition-colors hover:bg-white/5"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

function CorrectionCard({ state }: { state: CoachState }) {
  const task = state.task!
  const step = task.steps[state.stepIndex]
  const clip = expertClipFor(task, state.stepIndex)
  return (
    <motion.div
      className="absolute bottom-5 right-5 w-[336px] overflow-hidden rounded-[14px] border border-err/50 bg-stage/90"
      initial={{ x: 380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 380, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
    >
      <div className="relative">
        <ExpertClip clip={clip} start={step.expert_start_s} end={step.expert_end_s} variant={state.stepIndex + 1} className="aspect-video w-full" />
        <div className="absolute left-2.5 top-2.5 rounded-full bg-stage/80 px-2.5 py-0.5 font-mono text-[13px] text-ink">
          Expert · {clip?.take_label ?? 'best take'}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
          <motion.div
            className="h-full bg-ink/80"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: Math.max(2, step.expert_end_s - step.expert_start_s), ease: 'linear', repeat: Infinity }}
          />
        </div>
      </div>
      {/* the spoken correction is already in the caption; the card only says what to watch */}
      <div className="px-4 pb-3.5 pt-3">
        <p className="font-mono text-[14px] text-err">Do it like this · step {state.stepIndex + 1}</p>
        <p className="mt-1 text-[18px] leading-[1.3] text-ink">{step.text}</p>
      </div>
    </motion.div>
  )
}

function Rail({ state, shownIndex, elapsed, rehearsal, forced }: { state: CoachState; shownIndex: number; elapsed: number; rehearsal: boolean; forced: boolean }) {
  const task = state.task
  const latency = state.lastLatencyMs != null ? `${(state.lastLatencyMs / 1000).toFixed(1)} s` : null
  let status: { dot: string; text: string }
  if (state.phase === 'idle') status = { dot: 'bg-ink-3', text: 'Camera ready' }
  else if (state.error && state.phase !== 'complete') status = { dot: 'bg-wip', text: `Model unreachable · retrying` }
  else if (state.phase === 'detecting') status = { dot: 'bg-wip', text: 'Matching to the library' }
  else if (state.phase === 'complete') status = { dot: 'bg-go', text: `Complete · ${fmt(elapsed)}` }
  else if (state.stepStatus === 'mistake') status = { dot: 'bg-err', text: `Waiting for a fix${latency ? ` · ${latency}` : ''}` }
  else status = { dot: 'bg-go', text: `Watching${latency ? ` · ${latency}` : ''}` }

  return (
    <div className="absolute bottom-[262px] left-[1344px] right-24 top-[152px] flex flex-col">
      <div className="font-mono text-[17px] text-ink-2">Task</div>
      <AnimatePresence mode="wait">
        <motion.h2
          key={task?.id ?? state.phase}
          className={`mt-2 text-[40px] font-medium leading-[1.08] tracking-[-0.025em] ${task ? 'text-ink' : 'text-ink-3'}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          {task ? task.label : state.phase === 'detecting' ? 'Recognising…' : 'Start any task'}
        </motion.h2>
      </AnimatePresence>
      {task && (
        <motion.p className="mt-2 font-mono text-[16px] text-ink-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          {forced ? 'selected by presenter' : 'recognised'} · {task.steps.length} learned steps
        </motion.p>
      )}

      {!task && <KnownTasks detecting={state.phase === 'detecting'} />}

      <div className="mt-10 flex flex-col">
        {task?.steps.map((step, i) => {
          const done = i < shownIndex
          const current = i === shownIndex && state.phase === 'coaching'
          const err = current && state.stepStatus === 'mistake'
          const rec = state.steps[i]
          return (
            <motion.div
              key={step.id}
              layout
              className={`relative flex items-start gap-4 overflow-hidden border-t border-line ${current ? 'py-6' : 'py-3.5'}`}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.06, type: 'spring', stiffness: 300, damping: 30 }}
            >
              {done && rec?.at != null && <Sweep key={`sweep-${i}`} />}
              <div className="mt-[6px] flex w-7 shrink-0 justify-center">
                {done ? (
                  <Tick fixed={rec?.outcome === 'fixed'} />
                ) : (
                  <span className={`tnum font-mono text-[17px] ${current ? (err ? 'text-err' : 'text-wip') : 'text-ink-3'}`}>{i + 1}</span>
                )}
              </div>
              <motion.span
                layout="position"
                className={`leading-[1.15] tracking-[-0.015em] ${
                  current ? `text-[34px] font-medium text-balance ${err ? 'text-err' : 'text-ink'}` : done ? 'text-[22px] text-ink-2' : 'text-[22px] text-ink-3'
                }`}
              >
                {step.text}
              </motion.span>
              {done && rec?.at != null && <span className="tnum ml-auto mt-[4px] font-mono text-[16px] text-ink-3">{fmt(rec.at)}</span>}
            </motion.div>
          )
        })}
      </div>

      <div className="mt-auto">
      {task && state.phase === 'coaching' && state.stepStatus !== 'mistake' && <Reference task={task} stepIndex={shownIndex} />}
      <div className="flex items-center gap-3 border-t border-line pt-5">
        <span className="relative flex h-2.5 w-2.5">
          {(state.phase === 'detecting' || state.phase === 'coaching') && (
            <span className={`absolute inset-0 animate-ping rounded-full opacity-40 ${status.dot}`} style={{ animationDuration: '2s' }} />
          )}
          <span className={`relative h-2.5 w-2.5 rounded-full ${status.dot}`} />
        </span>
        <span className="tnum font-mono text-[18px] text-ink-2">{status.text}</span>
        {rehearsal && <span className="ml-auto font-mono text-[15px] text-ink-3">rehearsal checker</span>}
      </div>
      </div>
    </div>
  )
}

/** Idle / recognising: the tasks Understudy has learned, so the rail is never empty. */
function KnownTasks({ detecting }: { detecting: boolean }) {
  return (
    <div className="mt-10">
      <p className="font-mono text-[16px] text-ink-3">Learned from our recordings</p>
      <div className="mt-3 flex flex-col">
        {tasks().map((t, i) => {
          const best = library.clips.filter((c) => c.cluster_id === t.id).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
          return (
            <motion.div
              key={t.id}
              className="flex h-[84px] items-center gap-5 border-t border-line"
              animate={{ opacity: detecting ? [0.55, 1, 0.55] : 1 }}
              transition={detecting ? { duration: 1.6, repeat: Infinity, delay: i * 0.25 } : { duration: 0.3 }}
            >
              <Thumb clip={best} className="h-[54px] w-[96px] shrink-0 rounded-[6px]" />
              <span className="flex-1 text-[24px] tracking-[-0.01em] text-ink">{t.label}</span>
              <span className="tnum font-mono text-[16px] text-ink-3">{t.steps.length} steps</span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/** What good looks like for the current step, from the best take. */
function Reference({ task, stepIndex }: { task: Cluster; stepIndex: number }) {
  const step = task.steps[stepIndex]
  if (!step) return null
  const clip = expertClipFor(task, stepIndex)
  return (
    <motion.div
      key={step.id}
      className="flex items-center gap-4 pb-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.3 }}
    >
      <ExpertClip clip={clip} start={step.expert_start_s} end={step.expert_end_s} variant={stepIndex + 1} className="h-[72px] w-[128px] shrink-0 rounded-[8px]" />
      <div>
        <p className="font-mono text-[15px] text-ink-3">Expert reference</p>
        <p className="mt-1 text-[18px] text-ink-2">
          {clip?.take_label ?? 'Best take'} · {fmt(step.expert_start_s)}
        </p>
      </div>
    </motion.div>
  )
}

function Sweep() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-y-0 w-full"
      style={{ background: 'linear-gradient(90deg, transparent, rgba(75,227,138,0.22), transparent)' }}
      initial={{ x: '-100%' }}
      animate={{ x: '100%' }}
      transition={{ duration: 0.7, ease: [0.3, 0.6, 0.3, 1] }}
    />
  )
}

function Tick(_: { fixed?: boolean }) {
  return (
    <motion.svg width="22" height="22" viewBox="0 0 22 22" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
      <motion.path
        d="M4 11.5 L9 16 L18 6"
        fill="none"
        stroke="#4BE38A"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      />
    </motion.svg>
  )
}
