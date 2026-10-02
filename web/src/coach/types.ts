import type { Cluster, Step } from '../data/types'

export interface Frame {
  blob: Blob
  /** object URL / data URL for showing the frame in the UI */
  url: string
  /** ms since session start */
  at: number
}

export interface CheckResult {
  done: boolean
  /** Present when the person is doing something wrong; spoken + shown as a correction */
  issue?: string
  /** Model latency to show in the status line; measured if omitted */
  latencyMs?: number
}

/** Decides whether the current step is done. Real impl: Cosmos Reason via our server. */
export interface StepChecker {
  check(frames: Frame[], step: Step, task: Cluster): Promise<CheckResult>
}

export interface Recognition {
  task: Cluster
  confidence: number
}

/** Picks the task from the first seconds of video. Real impl: Cosmos Embed nearest cluster. */
export interface TaskRecognizer {
  recognize(frames: Frame[]): Promise<Recognition | null>
}

export type StepOutcome = 'done' | 'fixed' | 'missed'

export interface StepRecord {
  step: Step
  outcome: StepOutcome
  /** seconds since session start when the step was completed */
  at: number | null
}

export interface MistakeRecord {
  stepIndex: number
  issue: string
  at: number
  /** what the camera saw at the moment of the mistake */
  frameUrl: string | null
}

export interface SessionResult {
  task: Cluster
  steps: StepRecord[]
  mistakes: MistakeRecord[]
  durationS: number
  score: number
  feedback: [string, string]
}
