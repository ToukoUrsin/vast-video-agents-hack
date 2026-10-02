import { useEffect, useReducer, useRef, useState } from 'react'
import { coachReducer, initialCoach } from './machine'
import { captureFrames, chime, speak, stopSpeaking } from './media'
import type { StepChecker, TaskRecognizer } from './types'
import type { Cluster } from '../data/types'

export type CameraState = 'pending' | 'live' | 'denied' | 'unavailable'

/** Webcam stream into a <video>; handles permission denial without throwing. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<CameraState>('pending')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable')
      return
    }
    setState('pending')
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const v = videoRef.current
        if (v) {
          v.srcObject = s
          v.play().catch(() => {})
        }
        setState('live')
      })
      .catch((e: DOMException) => {
        if (!cancelled) setState(e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied' : 'unavailable')
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [attempt])
  return { videoRef, camera: state, retry: () => setAttempt((a) => a + 1) }
}

export function useCoach(opts: {
  video: React.RefObject<HTMLVideoElement | null>
  checker: StepChecker
  recognizer: TaskRecognizer & { lastError?: string | null }
  voice: boolean
  /** consecutive "done" answers needed before a step ticks (2 for the live model, 1 for the mock) */
  requiredDone: number
}) {
  const [state, dispatch] = useReducer(coachReducer, initialCoach)
  const ref = useRef(state)
  ref.current = state
  const { checker, recognizer, video, requiredDone } = opts

  // task recognition from the first seconds of video; retries until it gets an answer
  useEffect(() => {
    if (state.phase !== 'detecting') return
    let cancelled = false
    ;(async () => {
      while (!cancelled) {
        const frames = await captureFrames(video.current, 8, 2400, ref.current.startedAt)
        if (cancelled) return
        const rec = await recognizer.recognize(frames)
        if (cancelled) return
        if (rec) {
          dispatch({ type: 'TASK_DETECTED', task: rec.task, now: performance.now() })
          return
        }
        dispatch({ type: 'ERROR', error: recognizer.lastError ?? 'recognition failed' })
        await new Promise((r) => setTimeout(r, 800))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state.phase, recognizer, video])

  // step-check loop: ~4 frames every ~2.5 s -> checker -> debounce -> reducer
  useEffect(() => {
    if (state.phase !== 'coaching') return
    let cancelled = false
    let doneStreak = 0
    let streakStep = -1
    ;(async () => {
      while (!cancelled) {
        const s = ref.current
        if (s.phase !== 'coaching' || !s.task) break
        const frames = await captureFrames(video.current, 4, 2000, s.startedAt)
        if (cancelled) break
        const cur = ref.current
        if (!cur.task || cur.phase !== 'coaching') break
        const stepIndex = cur.stepIndex
        const t0 = performance.now()
        const result = await checker.check(frames, cur.task.steps[stepIndex], cur.task)
        if (cancelled) break
        const measured = performance.now() - t0
        if (ref.current.stepIndex !== stepIndex) continue
        const st = result.state ?? (result.done ? 'done' : result.issue ? 'mistake' : 'working')
        if (streakStep !== stepIndex) {
          doneStreak = 0
          streakStep = stepIndex
        }
        doneStreak = st === 'done' ? doneStreak + 1 : 0
        const act = st === 'done' && doneStreak >= requiredDone
        if (act) doneStreak = 0
        dispatch({
          type: 'CHECK',
          result: {
            done: act,
            state: act ? 'done' : st === 'mistake' && result.issue ? 'mistake' : 'working',
            // a confident mistake = the model gave a concrete correction
            issue: st === 'mistake' && result.issue ? result.issue : undefined,
            error: result.error,
          },
          latencyMs: result.latencyMs ?? measured,
          now: performance.now(),
          frameUrl: frames.at(-1)?.url ?? null,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state.phase, checker, video, requiredDone])

  // voice + chime side effects
  useEffect(() => {
    if (!state.utterance) return
    if (opts.voice) speak(state.utterance.text)
    if (state.utterance.tone === 'error') chime('error')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.utterance?.id])
  useEffect(() => {
    if (state.tick > 0) chime('good')
  }, [state.tick])
  useEffect(() => () => stopSpeaking(), [])

  return {
    state,
    start: () => dispatch({ type: 'START', now: performance.now() }),
    forceTask: (task: Cluster) => dispatch({ type: 'TASK_DETECTED', task, now: performance.now() }),
    reset: () => {
      stopSpeaking()
      dispatch({ type: 'RESET' })
    },
  }
}
