import { useEffect, useState, type ReactNode } from 'react'
import { STAGE_H, STAGE_W } from '../lib/field'

/** Fixed 1920×1080 artboard scaled to fit the window, letterboxed. */
export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden">
      <div
        className="relative shrink-0 overflow-hidden bg-stage"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: 'center' }}
      >
        {children}
      </div>
    </div>
  )
}
