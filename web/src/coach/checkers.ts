import type { Cluster, Step } from '../data/types'
import type { CheckResult, Frame, Recognition, StepChecker, TaskRecognizer } from './types'

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

/** Live checker: our server asks Cosmos Reason about the current step. */
export class HttpStepChecker implements StepChecker {
  private url: string
  constructor(url = '/api/check-step') {
    this.url = url
  }
  async check(frames: Frame[], step: Step, task: Cluster): Promise<CheckResult> {
    if (!frames.length) return { done: false, state: 'working', error: 'no camera frames' }
    const i = task.steps.findIndex((s) => s.id === step.id)
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          frames: frames.map((f) => f.url),
          task: task.label,
          step: step.text,
          prev_step: task.steps[i - 1]?.text ?? null,
          next_step: task.steps[i + 1]?.text ?? null,
        }),
      })
      if (!res.ok) return { done: false, state: 'working', error: `server ${res.status}` }
      const j = (await res.json()) as { state?: string; done?: boolean; issue?: string; error?: string; advance_to?: number; tentative?: boolean }
      const state = (['done', 'working', 'mistake'].includes(j.state ?? '') ? j.state : j.done ? 'done' : 'working') as CheckResult['state']
      const advanceTo = typeof j.advance_to === 'number' && j.advance_to > i ? j.advance_to : undefined
      return { state, done: state === 'done', issue: j.issue || undefined, error: j.error, advanceTo, tentative: !!j.tentative }
    } catch (e) {
      return { done: false, state: 'working', error: (e as Error).message || 'unreachable' }
    }
  }
}

/** Live recognizer: /api/identify embeds the first seconds and picks the nearest learned task. */
export class HttpTaskRecognizer implements TaskRecognizer {
  private resolve: (idOrLabel: string) => Cluster | undefined
  lastError: string | null = null
  constructor(resolve: (idOrLabel: string) => Cluster | undefined) {
    this.resolve = resolve
  }
  async recognize(frames: Frame[]): Promise<Recognition | null> {
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
