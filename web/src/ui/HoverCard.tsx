import { useRef } from 'react'
import { motion } from 'framer-motion'
import { library } from '../data'
import type { Clip } from '../data/types'
import type { Rect } from '../lib/field'
import { Thumb } from './Thumb'

export function HoverCard({ clip, rect }: { clip: Clip; rect: Rect }) {
  const site = library.sites.find((s) => s.id === clip.location)
  const W = 384
  const right = rect.x + rect.w + 16 + W < 1900
  const x = right ? rect.x + rect.w + 16 : rect.x - 16 - W
  const y = Math.min(Math.max(rect.y - 60, 120), 1080 - 360)
  const ref = useRef<HTMLDivElement>(null)
  return (
    <motion.div
      ref={ref}
      className="absolute z-40 overflow-hidden rounded-[16px] border border-line-strong bg-surface"
      style={{ left: x, top: y, width: W }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
    >
      <Thumb clip={clip} className="aspect-video w-full" />
      <div className="px-5 pb-5 pt-4">
        <p className="text-[20px] leading-[1.35] text-ink">{clip.caption}</p>
        <p className="mt-3 font-mono text-[15px] text-ink-3">
          {clip.source === 'ours' ? `${clip.take_label} · our recording` : `${site?.name} · ${clip.camera_id.split('-').pop()}`}
          {clip.duration_s ? ` · 0:${String(clip.duration_s).padStart(2, '0')}` : ''}
        </p>
      </div>
    </motion.div>
  )
}
