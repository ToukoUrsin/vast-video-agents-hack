import { useEffect, useRef, useState } from 'react'
import type { Clip } from '../data/types'
import { getThumb, onThumbsChange } from '../lib/thumbs'

/** DOM thumbnail for panels; draws the same image the canvas uses (real or procedural). */
export function Thumb({
  clip,
  className = '',
  size = 'lg',
  kenBurns = false,
}: {
  clip: Clip | undefined
  className?: string
  size?: 'sm' | 'lg'
  kenBurns?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [v, setV] = useState(0)
  useEffect(() => {
    const off = onThumbsChange(() => setV((x) => x + 1))
    return () => {
      off()
    }
  }, [])
  useEffect(() => {
    const c = ref.current
    if (!c || !clip) return
    const img = getThumb(clip, size)
    const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width
    const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0)
  }, [clip, size, v])
  return (
    <div className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative'} overflow-hidden bg-surface ${className}`}>
      <canvas
        ref={ref}
        className="absolute inset-0 h-full w-full object-cover"
        style={kenBurns ? { animation: 'kenburns 9s ease-in-out infinite alternate' } : undefined}
      />
    </div>
  )
}
