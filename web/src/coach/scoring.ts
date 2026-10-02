// Placeholder scoring + feedback. The real feedback comes from the W&B-hosted LLM later;
// keep the same SessionResult shape.
import type { Cluster } from '../data/types'
import { getClip } from '../data'
import type { MistakeRecord, SessionResult, StepRecord } from './types'
import { gerund } from './machine'

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
  const others = steps.length - mistakes.length
  return [
    `Skipped ${gerund(step.text)} at first, then fixed it after the prompt${after.at ? ` at ${fmt(after.at)}` : ''}.`,
    `The other ${others} steps matched the best take, in order and at a similar pace.`,
  ]
}

export const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/** What the Score screen shows if no live session has run yet. */
export function demoResult(task: Cluster): SessionResult {
  const times = [6.2, 18.4, 25.1, 41.7, 47.3]
  // the sample mirrors the scripted demo mistake: the first step that has a known correction
  const k = Math.max(0, task.steps.findIndex((s) => s.common_mistake))
  const steps: StepRecord[] = task.steps.map((step, i) => ({ step, outcome: i === k ? 'fixed' : 'done', at: times[i] ?? times[times.length - 1] }))
  const mistakes: MistakeRecord[] = [
    { stepIndex: k, issue: task.steps[k].common_mistake ?? 'Step skipped.', at: Math.max(0, (times[k] ?? 30) - 6), frameUrl: null },
  ]
  return { task, steps, mistakes, durationS: 54.8, score: 82, feedback: buildFeedback(task, steps, mistakes) }
}

export const expertClipFor = (task: Cluster, stepIndex: number) => getClip(task.steps[stepIndex]?.expert_clip_id ?? '')
