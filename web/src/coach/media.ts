import type { Frame } from './types'

/** Grab `n` JPEG frames from a playing video, spaced `spanMs / n` apart. Unmirrored. */
export async function captureFrames(video: HTMLVideoElement | null, n = 4, spanMs = 2000, t0 = 0): Promise<Frame[]> {
  if (!video || video.readyState < 2 || !video.videoWidth) return []
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 640 / video.videoWidth)
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d')!
  const frames: Frame[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, spanMs / n))
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.72))
    if (blob) frames.push({ blob, url: canvas.toDataURL('image/jpeg', 0.6), at: performance.now() - t0 })
  }
  return frames
}

let voice: SpeechSynthesisVoice | null = null
const PREFERRED = ['Ava (Premium)', 'Zoe (Premium)', 'Evan (Premium)', 'Samantha (Enhanced)', 'Ava (Enhanced)', 'Google US English', 'Samantha', 'Daniel', 'Karen']

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  for (const name of PREFERRED) {
    const v = voices.find((x) => x.name === name)
    if (v) return v
  }
  return voices.find((v) => v.lang === 'en-US' && v.localService) ?? voices.find((v) => v.lang.startsWith('en')) ?? null
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => (voice = pickVoice())
  voice = pickVoice()
}

export function speak(text: string) {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  if (voice) u.voice = voice
  u.rate = 1.02
  u.pitch = 1
  synth.speak(u)
}

export const stopSpeaking = () => window.speechSynthesis?.cancel()

let audio: AudioContext | null = null
/** Soft two-note chime for a completed step; low single note for a mistake. */
export function chime(kind: 'good' | 'error') {
  audio ??= new AudioContext()
  const now = audio.currentTime
  const notes = kind === 'good' ? [880, 1318.5] : [220]
  notes.forEach((f, i) => {
    const o = audio!.createOscillator()
    const g = audio!.createGain()
    o.type = 'sine'
    o.frequency.value = f
    const t = now + i * 0.09
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(kind === 'good' ? 0.08 : 0.1, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'good' ? 0.5 : 0.35))
    o.connect(g).connect(audio!.destination)
    o.start(t)
    o.stop(t + 0.6)
  })
}
