import type { Cluster, Step } from '../data/types'
import type { CheckResult, Frame, Recognition, StepChecker, TaskRecognizer } from './types'
import { recordCheck } from './trace'

type Command = 'done' | 'mistake'

/**
 * Rehearsal checker. Each check() waits up to `windowMs` for a dev key:
 * N -> step done, M -> mistake (uses the step's common_mistake text).
 * With no key it reports "still working".
 */
export class MockStepChecker implements StepChecker {
  private queue: Command[] = []
  private wake: (() => void) | null = null
  private windowMs: number
  constructor(windowMs = 1800) {
    this.windowMs = windowMs
  }

  push(cmd: Command) {
    this.queue.push(cmd)
    this.wake?.()
  }

  clear() {
    this.queue = []
  }

  async check(_frames: Frame[], step: Step): Promise<CheckResult> {
    if (!this.queue.length) {
      await new Promise<void>((res) => {
        const t = setTimeout(res, this.windowMs)
        this.wake = () => {
          clearTimeout(t)
          res()
        }
      })
      this.wake = null
    }
    // simulated model latency so the status line looks real
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 400))
    const cmd = this.queue.shift()
    const latencyMs = 1700 + Math.random() * 700
    if (cmd === 'done') return { state: 'done', done: true, latencyMs }
    if (cmd === 'mistake')
      return { state: 'mistake', done: false, issue: step.common_mistake ?? `That doesn't look like "${step.text}" yet.`, latencyMs }
    return { state: 'working', done: false, latencyMs }
  }
}

/** Rehearsal recognizer: returns the given task after a fixed delay. */
export class MockTaskRecognizer implements TaskRecognizer {
  private task: Cluster
  private delayMs: number
  constructor(task: Cluster, delayMs = 3800) {
    this.task = task
    this.delayMs = delayMs
  }
  setTask(task: Cluster) {
    this.task = task
  }
  async recognize(): Promise<Recognition> {
    await new Promise((r) => setTimeout(r, this.delayMs))
    return { task: this.task, confidence: 0.91 }
  }
}

/** Live checker: our server asks the vision model (Gemini, Cosmos fallback) about the current step. */
export class HttpStepChecker implements StepChecker {
  private url: string
  constructor(url = '/api/check-step') {
    this.url = url
  }
  async check(frames: Frame[], step: Step, task: Cluster): Promise<CheckResult> {
    if (!frames.length) return { done: false, state: 'working', error: 'no camera frames' }
    const i = task.steps.findIndex((s) => s.id === step.id)
    const t0 = performance.now()
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          frames: frames.map((f) => f.url),
          task: task.label,
          step: step.text,
          session: coachSession,
          prev_step: task.steps[i - 1]?.text ?? null,
          next_step: task.steps[i + 1]?.text ?? null,
        }),
      })
      if (!res.ok) {
        trace(step.text, i, t0, { error: `server ${res.status}` })
        return { done: false, state: 'working', error: `server ${res.status}` }
      }
      const j = (await res.json()) as { state?: string; done?: boolean; issue?: string; error?: string; advance_to?: number; tentative?: boolean; confident?: boolean }
      trace(step.text, i, t0, j)
      const state = (['done', 'working', 'mistake'].includes(j.state ?? '') ? j.state : j.done ? 'done' : 'working') as CheckResult['state']
      const advanceTo = typeof j.advance_to === 'number' && j.advance_to > i ? j.advance_to : undefined
      return { state, done: state === 'done', issue: j.issue || undefined, error: j.error, advanceTo, tentative: !!j.tentative, confident: !!j.confident }
    } catch (e) {
      trace(step.text, i, t0, { error: (e as Error).message || 'unreachable' })
      return { done: false, state: 'working', error: (e as Error).message || 'unreachable' }
    }
  }
}

/** Side log for the reasoning-trace drawer; must never affect the check result. */
function trace(step: string, stepIndex: number, t0: number, j: Record<string, unknown>) {
  try {
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
    recordCheck({
      at: Date.now(),
      step,
      stepIndex,
      state: typeof j.state === 'string' ? j.state : undefined,
      observation: (j.observation as Record<string, unknown> | string | undefined) ?? null,
      completed: Array.isArray(j.completed_steps) ? (j.completed_steps as number[]) : [],
      advanceTo: num(j.advance_to),
      issue: typeof j.issue === 'string' && j.issue ? j.issue : undefined,
      observeMs: num(j.observe_ms),
      judgeMs: num(j.judge_ms),
      serverMs: num(j.latency_ms),
      roundTripMs: performance.now() - t0,
      judge: typeof j.judge === 'string' ? j.judge : undefined,
      model: typeof j.perception_model === 'string' ? j.perception_model : undefined,
      error: typeof j.error === 'string' ? j.error : undefined,
    })
  } catch {
    // tracing is best effort
  }
}

/** One id per coaching session so the server can remember the starting layout (e.g. bottle order). */
let coachSession = `s${Date.now()}`

/** Live recognizer: /api/identify embeds the first seconds and picks the nearest learned task. */
export class HttpTaskRecognizer implements TaskRecognizer {
  private resolve: (idOrLabel: string) => Cluster | undefined
  lastError: string | null = null
  constructor(resolve: (idOrLabel: string) => Cluster | undefined) {
    this.resolve = resolve
  }
  async recognize(frames: Frame[]): Promise<Recognition | null> {
    // recognition only runs at the start of a session: frames start near 0 ms
    if (frames.length && frames[0].at < 1500) coachSession = `s${Date.now()}`
    if (!frames.length) {
      this.lastError = 'no camera frames'
      return null
    }
    try {
      const res = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ frames: frames.map((f) => f.url) }),
      })
      if (!res.ok) throw new Error(`server ${res.status}`)
      const j = (await res.json()) as { task_id?: string | null; task?: string | null; confidence?: number }
      if (!j.task_id && !j.task) {
        // nothing recognisable in frame yet: keep watching, not an error
        this.lastError = null
        return null
      }
      const task = this.resolve(j.task_id ?? '') ?? this.resolve(j.task ?? '')
      if (!task) throw new Error(`unknown task ${j.task_id ?? j.task}`)
      this.lastError = null
      return { task, confidence: j.confidence ?? 0 }
    } catch (e) {
      this.lastError = (e as Error).message || 'unreachable'
      return null
    }
  }
}
