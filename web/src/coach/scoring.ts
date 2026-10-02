// Placeholder scoring + feedback. The real feedback comes from the W&B-hosted LLM later;
// keep the same SessionResult shape.
import type { Cluster } from '../data/types'
import { getClip } from '../data'
import type { MistakeRecord, SessionResult, StepRecord } from './types'

export function scoreSession(steps: StepRecord[], mistakes: MistakeRecord[], durationS: number) {
  let s = 100
  s -= mistakes.length * 14
  s -= steps.filter((r) => r.outcome === 'missed').length * 20
  s -= Math.min(6, Math.max(0, (durationS - 60) / 10))
  return Math.max(0, Math.min(100, Math.round(s)))
}

export function buildFeedback(task: Cluster, steps: StepRecord[], mistakes: MistakeRecord[]): [string, string] {
  if (!mistakes.length) return [`Clean run of ${task.label.toLowerCase()}, every step in order.`, 'Pace matched the best take.']
  const m = mistakes[0]
  const step = task.steps[m.stepIndex]
  const after = steps[m.stepIndex]
  return [
    `${step.text} was skipped at first and fixed after the prompt${after.at ? ` at ${fmt(after.at)}` : ''}.`,
    `Everything else matched the best take. Do ${step.text.toLowerCase()} before moving on.`,
  ]
}

export const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/** What the Score screen shows if no live session has run yet. */
export function demoResult(task: Cluster): SessionResult {
  const times = [6.2, 21.8, 29.4, 37.1, 52.6]
  const steps: StepRecord[] = task.steps.map((step, i) => ({ step, outcome: i === 1 ? 'fixed' : 'done', at: times[i] }))
  const mistakes: MistakeRecord[] = [
    { stepIndex: 1, issue: task.steps[1].common_mistake ?? 'Step skipped.', at: 14.3, frameUrl: null },
  ]
  return { task, steps, mistakes, durationS: 54.8, score: 82, feedback: buildFeedback(task, steps, mistakes) }
}

export const expertClipFor = (task: Cluster, stepIndex: number) => getClip(task.steps[stepIndex]?.expert_clip_id ?? '')
