import type { Cluster, Step } from '../data/types'

export interface Frame {
  blob: Blob
  /** object URL / data URL for showing the frame in the UI */
  url: string
  /** ms since session start */
  at: number
}

export type CheckState = 'done' | 'working' | 'mistake'

export interface CheckResult {
  /** Preferred: what the checker saw for the current step */
  state?: CheckState
  /** Legacy boolean; state wins when present */
  done: boolean
  /** Set when the checker could not be reached; the coach keeps watching */
  error?: string
  /** Present when the person is doing something wrong; spoken + shown as a correction */
  issue?: string
  /** Index of the first step NOT yet completed, when the person is ahead of the coach (catch-up) */
  advanceTo?: number
  /** Mistake seen while hands were still on the objects: needs a longer streak before it is spoken */
  tentative?: boolean
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
  /** 'llm' when /api/feedback produced score + feedback, else the local rule */
  scoredBy?: 'llm' | 'local'
  scoredModel?: string
  task: Cluster
  steps: StepRecord[]
  mistakes: MistakeRecord[]
  durationS: number
  score: number
  feedback: [string, string]
  /** what the camera saw when the last step ticked */
  finalFrameUrl?: string | null
}
