import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp, useKeys } from '../app/context'
import { getClip, getCluster, ingestOrder, library } from '../data'
import type { Clip, Cluster } from '../data/types'
import type { Camera, Rect } from '../lib/field'
import { clusterLayout, fitGrid, type MapLayout } from '../lib/layouts'
import { HoverCard } from '../ui/HoverCard'
import { Thumb } from '../ui/Thumb'

const AREA: Rect = { x: 96, y: 176, w: 1728, h: 800 }
const GRID_AREA: Rect = { x: 96, y: 200, w: 1728, h: 760 }
const STAGGER = 260
const DUR = 1250
const PANEL_X = 1232

const gridTargets = fitGrid(ingestOrder, GRID_AREA, 6)

export function MapScreen() {
  const { field, mapPhase, setMapPhase, dev } = useApp()
  const [layout, setLayout] = useState<MapLayout | null>(null)
  const [settled, setSettled] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<{ clip: Clip; rect: Rect } | null>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const camRef = useRef<Camera>({ x: 0, y: 0, s: 1 })
  const timers = useRef<number[]>([])

  const staticLayout = useMemo(() => clusterLayout(library.clips, library.clusters, AREA, { stagger: 0, dur: 900, animate: false }), [])

  // initial placement
  useEffect(() => {
    field.setFocus(null)
    field.setCamera({ x: 0, y: 0, s: 1 }, 600)
    field.interactive = true
    field.onCamera = (c) => {
      camRef.current = c
      if (overlay.current) overlay.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.s})`
    }
    field.onHover = (clip, rect) => setHover(clip && rect ? { clip, rect } : null)
    if (mapPhase === 'grid') {
      const t = new Map()
      ingestOrder.forEach((c, i) => t.set(c.clip_id, { ...gridTargets.get(c.clip_id)!, alpha: 1, dur: 900, delay: (i % 30) * 6 }))
      field.setTargets(t)
    } else {
      field.setTargets(staticLayout.targets)
      setLayout(staticLayout)
      setSettled(new Set(staticLayout.clusters.map((c) => c.id)))
    }
    return () => {
      field.onCamera = null
      field.onHover = null
      field.onClick = null
      field.interactive = false
      field.setFocus(null)
      field.setCamera({ x: 0, y: 0, s: 1 }, 500)
      timers.current.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field])

  const select = (id: string | null) => {
    setSelected(id)
    field.setFocus(id)
    const g = layout?.clusters.find((c) => c.id === id)
    if (!g) {
      field.setCamera({ x: 0, y: 0, s: 1 }, 900)
      return
    }
    const s = g.source === 'ours' ? 1.35 : 1.15
    const cx = g.box.x + g.box.w / 2
    const cy = g.box.y + g.box.h / 2 + 20
    field.setCamera({ x: PANEL_X / 2 - cx * s, y: 590 - cy * s, s }, 900)
  }

  useEffect(() => {
    field.onClick = (clip) => {
      if (mapPhase !== 'clusters') return
      select(clip?.cluster_id ?? null)
    }
  })

  const runClusters = () => {
    const l = clusterLayout(library.clips, library.clusters, AREA, { stagger: STAGGER, dur: DUR, animate: true })
    setLayout(l)
    setSettled(new Set())
    field.setTargets(l.targets)
    setMapPhase('clusters')
    timers.current.forEach(clearTimeout)
    timers.current = [...l.settleAt].map(([id, ms]) =>
      window.setTimeout(() => setSettled((s) => new Set(s).add(id)), ms),
    )
  }

  useKeys({
    ' ': () => {
      if (mapPhase === 'grid') runClusters()
    },
    escape: () => select(null),
    r: () => {
      select(null)
      setLayout(null)
      setSettled(new Set())
      setMapPhase('grid')
      const t = new Map()
      ingestOrder.forEach((c) => t.set(c.clip_id, { ...gridTargets.get(c.clip_id)!, alpha: 1, dur: 900 }))
      field.setTargets(t)
    },
  })

  const cluster = selected ? getCluster(selected) : undefined
  const nClusters = library.clusters.length
  const hoverScreen = hover ? toScreen(hover.rect, camRef.current) : null

  return (
    <div className="absolute inset-0">
      <div className="absolute left-24 top-[132px] flex items-baseline gap-4">
        <span className="text-[22px] font-medium tracking-[-0.01em]">Map</span>
        <AnimatePresence mode="wait">
          {mapPhase === 'grid' ? (
            <motion.span key="g" className="font-mono text-[18px] text-ink-3" exit={{ opacity: 0 }}>
              {ingestOrder.length} clips · no labels
            </motion.span>
          ) : (
            <motion.span key="c" className="font-mono text-[18px] text-ink-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              {nClusters} activities found · 0 labels given
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* labels + chips follow the canvas camera */}
      <div ref={overlay} className="absolute left-0 top-0 h-[1080px] w-[1920px] origin-top-left">
        {layout?.clusters.map((g) => {
          const on = settled.has(g.id)
          const dim = selected && selected !== g.id
          return (
            <motion.button
              key={g.id}
              className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap"
              style={{ left: g.box.x + g.box.w / 2, top: g.box.y + g.box.h + (g.source === 'ours' ? 18 : 14) }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: on ? (dim ? 0.2 : 1) : 0, y: on ? 0 : 6 }}
              transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
              onClick={() => mapPhase === 'clusters' && select(g.id)}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: g.tint }} />
              <span className={`${g.source === 'ours' ? 'text-[24px] font-medium' : 'text-[20px]'} tracking-[-0.01em] text-ink`}>{g.label}</span>
              <span className="tnum font-mono text-[17px] text-ink-2">
                {g.count}
                {g.source === 'ours' ? ' takes' : ''}
              </span>
            </motion.button>
          )
        })}
        {layout?.chips.map(({ clip, rect, sloppy }) => {
          const on = settled.has(clip.cluster_id ?? '')
          const dim = selected && selected !== clip.cluster_id
          return (
            <motion.div
              key={clip.clip_id}
              className="absolute flex items-center gap-1.5 rounded-[6px] bg-stage/85 px-2 py-0.5"
              style={{ left: rect.x + 6, top: rect.y + 6 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: on ? (dim ? 0.15 : 1) : 0 }}
              transition={{ duration: 0.4, delay: on ? 0.25 : 0 }}
            >
              <span className={`tnum font-mono text-[15px] ${sloppy ? 'text-err' : 'text-ink'}`}>{clip.score}</span>
            </motion.div>
          )
        })}
      </div>

      {mapPhase === 'clusters' && (
        <motion.div
          className="absolute bottom-12 left-24 flex items-center gap-10 font-mono text-[16px] text-ink-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: selected ? 0 : 1 }}
          transition={{ delay: selected ? 0 : 2.4, duration: 0.6 }}
        >
          <span>1 tile = 1 clip</span>
          <span>position = Cosmos Embed similarity</span>
          <span>
            <span className="text-err">52</span> = take below the learned standard
          </span>
        </motion.div>
      )}

      <AnimatePresence>{cluster && <StepsPanel key={cluster.id} cluster={cluster} onClose={() => select(null)} />}</AnimatePresence>
      <AnimatePresence>{hover && hoverScreen && !selected && <HoverCard key={hover.clip.clip_id} clip={hover.clip} rect={hoverScreen} />}</AnimatePresence>

      {dev && <div className="absolute bottom-4 right-6 font-mono text-[14px] text-ink-3">dev · Space cluster · click cluster · Esc close · R regrid</div>}
    </div>
  )
}

function toScreen(r: Rect, c: Camera): Rect {
  return { x: r.x * c.s + c.x, y: r.y * c.s + c.y, w: r.w * c.s, h: r.h * c.s }
}

function StepsPanel({ cluster, onClose }: { cluster: Cluster; onClose: () => void }) {
  const members = library.clips.filter((c) => c.cluster_id === cluster.id)
  const best = [...members].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  const ours = cluster.source === 'ours'
  return (
    <motion.aside
      className="pointer-events-auto absolute bottom-6 right-6 top-[120px] w-[664px] rounded-[24px] border border-line bg-surface px-12 pt-11"
      initial={{ x: 700, opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 700, opacity: 0.6 }}
      transition={{ type: 'spring', stiffness: 260, damping: 34 }}
    >
      <button onClick={onClose} className="absolute right-8 top-8 font-mono text-[15px] text-ink-3 hover:text-ink-2">
        Esc
      </button>
      <p className="font-mono text-[17px] text-ink-2">
        Learned from {members.length} {ours ? 'takes' : 'clips'}
      </p>
      <h2 className="mt-2 text-[44px] font-medium leading-[1.05] tracking-[-0.025em]">{cluster.label}</h2>
      <p className="mt-3 text-[20px] text-ink-2">
        {cluster.steps.length} steps
        {ours && best ? (
          <>
            {' · '}expert clips from {best.take_label}, score <span className="tnum font-mono text-ink">{best.score}</span>
          </>
        ) : null}
      </p>
      <ol className="mt-9 flex flex-col">
        {cluster.steps.map((step, i) => {
          const clip = getClip(step.expert_clip_id) ?? members[(i * 7) % members.length]
          return (
            <motion.li
              key={step.id}
              className="flex h-[118px] items-center gap-6 border-t border-line"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.18 + i * 0.07, type: 'spring', stiffness: 300, damping: 30 }}
            >
              <span className="tnum w-8 font-mono text-[20px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
              <span className="flex-1 text-[26px] leading-tight tracking-[-0.01em] text-ink">{step.text}</span>
              <div className="relative">
                <Thumb clip={clip} className="h-[90px] w-[160px] rounded-[8px]" kenBurns />
                <span className="tnum absolute bottom-1.5 right-1.5 rounded-[4px] bg-stage/80 px-1.5 font-mono text-[13px] text-ink-2">
                  {fmtS(step.expert_start_s)}–{fmtS(step.expert_end_s)}
                </span>
              </div>
            </motion.li>
          )
        })}
      </ol>
    </motion.aside>
  )
}

const fmtS = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
