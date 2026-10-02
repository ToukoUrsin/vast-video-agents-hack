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
    if (cmd === 'done') return { done: true, latencyMs }
    if (cmd === 'mistake') return { done: false, issue: step.common_mistake ?? `That doesn't look like "${step.text}" yet.`, latencyMs }
    return { done: false, latencyMs }
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

/**
 * Real checker seam: POSTs frames to our server proxy which asks Cosmos Reason
 * "Has the person completed '<step>'? If not, what is wrong?".
 * Expected response JSON: { done: boolean, issue?: string }.
 */
export class HttpStepChecker implements StepChecker {
  private url: string
  constructor(url = '/api/check-step') {
    this.url = url
  }
  async check(frames: Frame[], step: Step, task: Cluster): Promise<CheckResult> {
    const body = new FormData()
    body.set('task', task.label)
    body.set('step', step.text)
    frames.forEach((f, i) => body.append('frames', f.blob, `frame-${i}.jpg`))
    const res = await fetch(this.url, { method: 'POST', body })
    if (!res.ok) return { done: false }
    return (await res.json()) as CheckResult
  }
}
