// Reasoning trace: a passive log of every /api/check-step answer (what the vision model saw, which steps the
// fixed checks counted, latency split). Written by HttpStepChecker on the side; never read by the
// coach logic, only by the trace drawer and the Score footer.
import { useSyncExternalStore } from 'react'

export interface TraceRow {
  id: number
  /** wall clock, ms */
  at: number
  step: string
  stepIndex: number
  state?: string
  observation?: Record<string, unknown> | string | null
  completed: number[]
  advanceTo?: number
  issue?: string
  observeMs?: number
  judgeMs?: number
  /** server-side total */
  serverMs?: number
  /** client round trip, what the status line shows */
  roundTripMs: number
  judge?: string
  /** which vision model read the frame (Gemini, or Cosmos as fallback) */
  model?: string
  error?: string
}

let rows: TraceRow[] = []
let uid = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function recordCheck(r: Omit<TraceRow, 'id'>) {
  rows = [...rows, { ...r, id: ++uid }].slice(-400)
  emit()
}

export function clearTrace() {
  if (!rows.length) return
  rows = []
  emit()
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

export const useTrace = () => useSyncExternalStore(subscribe, () => rows)

export function traceStats(list: TraceRow[]) {
  const ok = list.filter((r) => !r.error).map((r) => r.roundTripMs).sort((a, b) => a - b)
  const median = ok.length ? (ok.length % 2 ? ok[(ok.length - 1) / 2] : (ok[ok.length / 2 - 1] + ok[ok.length / 2]) / 2) : null
  return { checks: list.length, median }
}

export const WEAVE_PROJECT = 'vastdata/team-39'
