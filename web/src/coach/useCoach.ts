import { useEffect, useReducer, useRef, useState } from 'react'
import { coachReducer, initialCoach } from './machine'
import { captureFrames, chime, speak, stopSpeaking } from './media'
import type { StepChecker, TaskRecognizer } from './types'

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
  recognizer: TaskRecognizer
  voice: boolean
}) {
  const [state, dispatch] = useReducer(coachReducer, initialCoach)
  const ref = useRef(state)
  ref.current = state
  const { checker, recognizer, video } = opts

  // task recognition from the first seconds of video
  useEffect(() => {
    if (state.phase !== 'detecting') return
    let cancelled = false
    ;(async () => {
      const frames = await captureFrames(video.current, 4, 2000, ref.current.startedAt)
      const rec = await recognizer.recognize(frames)
      if (!cancelled && rec) dispatch({ type: 'TASK_DETECTED', task: rec.task, now: performance.now() })
    })()
    return () => {
      cancelled = true
    }
  }, [state.phase, recognizer, video])

  // step-check loop: frames every ~2.5 s -> checker -> reducer
  useEffect(() => {
    if (state.phase !== 'coaching') return
    let cancelled = false
    ;(async () => {
      while (!cancelled) {
        const s = ref.current
        if (s.phase !== 'coaching' || !s.task) break
        const frames = await captureFrames(video.current, 3, 1500, s.startedAt)
        if (cancelled) break
        const cur = ref.current
        if (!cur.task) break
        const t0 = performance.now()
        const result = await checker.check(frames, cur.task.steps[cur.stepIndex], cur.task)
        if (cancelled) break
        dispatch({
          type: 'CHECK',
          result,
          latencyMs: result.latencyMs ?? performance.now() - t0,
          now: performance.now(),
          frameUrl: frames.at(-1)?.url ?? null,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state.phase, checker, video])

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
    reset: () => {
      stopSpeaking()
      dispatch({ type: 'RESET' })
    },
  }
}
