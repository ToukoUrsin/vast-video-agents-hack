import { useEffect, useRef } from 'react'
import type { Clip } from '../data/types'
import { Thumb } from './Thumb'

/**
 * Expert clip slot. Plays clip.video_url looped between start and end seconds when we
 * have real video; otherwise shows the (placeholder) thumbnail with a slow push-in.
 */
export function ExpertClip({ clip, start, end, variant = 0, className = '' }: { clip: Clip | undefined; start: number; end: number; variant?: number; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const loop = () => {
      if (v.currentTime >= end || v.currentTime < start - 0.5) v.currentTime = start
    }
    v.currentTime = start
    v.play().catch(() => {})
    v.addEventListener('timeupdate', loop)
    return () => v.removeEventListener('timeupdate', loop)
  }, [start, end, clip?.video_url])
  if (clip?.video_url)
    return (
      <div className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative'} overflow-hidden bg-surface ${className}`}>
        <video ref={ref} src={clip.video_url} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      </div>
    )
  return <Thumb clip={clip} variant={variant} className={className} kenBurns />
}
