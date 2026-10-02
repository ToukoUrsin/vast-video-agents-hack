// Coach session as a pure reducer. Side effects (speech, chime, frame capture, checker
// calls) live in useCoach; this file only decides what state comes next.
import type { Cluster } from '../data/types'
import type { CheckResult, MistakeRecord, SessionResult, StepRecord } from './types'
import { buildFeedback, scoreSession } from './scoring'

export type CoachPhase = 'idle' | 'detecting' | 'coaching' | 'complete'

export interface Utterance {
  id: number
  text: string
  tone: 'info' | 'good' | 'error'
}

export interface CoachState {
  phase: CoachPhase
  task: Cluster | null
  stepIndex: number
  /** mistake = waiting for the person to fix the current step */
  stepStatus: 'watching' | 'mistake'
  issue: string | null
  startedAt: number
  steps: StepRecord[]
  mistakes: MistakeRecord[]
  lastLatencyMs: number | null
  utterance: Utterance | null
  /** bumps each time a step completes, drives the tick animation + chime */
  tick: number
  /** when the last correction was spoken; corrections repeat at most every 6 s */
  lastCorrectionAt: number
  /** checker / recognizer could not be reached; shown in the status line */
  error: string | null
  result: SessionResult | null
}

export type CoachEvent =
  | { type: 'START'; now: number }
  | { type: 'TASK_DETECTED'; task: Cluster; now: number }
  | { type: 'CHECK'; result: CheckResult; latencyMs: number; now: number; frameUrl: string | null }
  | { type: 'ERROR'; error: string | null }
  | { type: 'RESET' }

export const initialCoach: CoachState = {
  phase: 'idle',
  task: null,
  stepIndex: 0,
  stepStatus: 'watching',
  issue: null,
  startedAt: 0,
  steps: [],
  mistakes: [],
  lastLatencyMs: null,
  utterance: null,
  tick: 0,
  result: null,
  lastCorrectionAt: 0,
  error: null,
}

export const CORRECTION_REPEAT_MS = 6000

let uid = 1
const say = (text: string, tone: Utterance['tone'] = 'info'): Utterance => ({ id: uid++, text, tone })
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function coachReducer(s: CoachState, e: CoachEvent): CoachState {
  switch (e.type) {
    case 'RESET':
      return { ...initialCoach }
    case 'START':
      if (s.phase !== 'idle') return s
      return { ...initialCoach, phase: 'detecting', startedAt: e.now }
    case 'ERROR':
      return s.error === e.error ? s : { ...s, error: e.error }
    case 'TASK_DETECTED': {
      if (s.phase !== 'detecting' && s.phase !== 'idle') return s
      const first = e.task.steps[0]
      return {
        ...s,
        startedAt: s.phase === 'idle' ? e.now : s.startedAt,
        error: null,
        phase: 'coaching',
        task: e.task,
        stepIndex: 0,
        steps: e.task.steps.map((step) => ({ step, outcome: 'done', at: null })),
        utterance: say(`${e.task.label}. Start by ${gerund(first.text)}.`),
      }
    }
    case 'CHECK': {
      if (s.phase !== 'coaching' || !s.task) return s
      const t = (e.now - s.startedAt) / 1000
      const base = { ...s, lastLatencyMs: e.result.error ? s.lastLatencyMs : e.latencyMs, error: e.result.error ?? null }
      if (e.result.error) return base
      const { result } = e
      if (result.done) {
        const steps = s.steps.map((r, i) =>
          i === s.stepIndex ? { ...r, outcome: s.stepStatus === 'mistake' ? ('fixed' as const) : ('done' as const), at: t } : r,
        )
        const next = s.stepIndex + 1
        if (next >= s.task.steps.length) {
          const done = { ...base, steps, stepStatus: 'watching' as const, issue: null, tick: s.tick + 1 }
          const durationS = t
          const score = scoreSession(steps, s.mistakes, durationS)
          return {
            ...done,
            phase: 'complete',
            stepIndex: next,
            utterance: say('That’s the whole task. Nice work.', 'good'),
            result: {
              task: s.task,
              steps,
              mistakes: s.mistakes,
              durationS,
              score,
              feedback: buildFeedback(s.task, steps, s.mistakes),
            },
          }
        }
        const wasFix = s.stepStatus === 'mistake'
        return {
          ...base,
          steps,
          stepIndex: next,
          stepStatus: 'watching',
          issue: null,
          tick: s.tick + 1,
          utterance: say(`${wasFix ? 'That’s it.' : 'Good.'} Now ${lower(s.task.steps[next].text)}.`, 'good'),
        }
      }
      if (result.issue && s.stepStatus !== 'mistake') {
        return {
          ...base,
          stepStatus: 'mistake',
          issue: result.issue,
          lastCorrectionAt: e.now,
          mistakes: [...s.mistakes, { stepIndex: s.stepIndex, issue: result.issue, at: t, frameUrl: e.frameUrl }],
          utterance: say(result.issue, 'error'),
        }
      }
      if (result.issue && s.stepStatus === 'mistake' && e.now - s.lastCorrectionAt >= CORRECTION_REPEAT_MS) {
        // still wrong: repeat the correction, but never more than once per 6 s
        return { ...base, issue: result.issue, lastCorrectionAt: e.now, utterance: say(result.issue, 'error') }
      }
      return base
    }
  }
}

export function gerund(stepText: string) {
  // "Fold bottom flaps" -> "folding bottom flaps"; good enough for the spoken intro
  const [verb, ...rest] = stepText.split(' ')
  const v = verb.toLowerCase()
  const irregular: Record<string, string> = { put: 'putting', tape: 'taping', close: 'closing', remove: 'removing', pour: 'pouring' }
  let g = irregular[v]
  if (!g) g = v.endsWith('e') && !v.endsWith('ee') ? v.slice(0, -1) + 'ing' : v + 'ing'
  return [g, ...rest].join(' ')
}
