import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useApp, useKeys } from '../app/context'
import { ingestOrder, library, siteCounts, tasks } from '../data'
import type { Clip, IngestStage } from '../data/types'
import type { Rect, TileTarget } from '../lib/field'
import { gridCells } from '../lib/layouts'
import { Thumb } from '../ui/Thumb'
import { HoverCard } from '../ui/HoverCard'

export const GRID_AREA: Rect = { x: 584, y: 212, w: 1240, h: 560 }
export const GRID_COLS = 24
export const GRID_GAP = 5

const cells = gridCells(ingestOrder.length, GRID_AREA, GRID_COLS, GRID_GAP)
const REPLAY_MS = library.ingest.replay_s * 1000
const STAGE_LAG = 520
const SEGMENT_MS = REPLAY_MS * 0.72

/** progress 0..1 for stage k at elapsed ms */
function stageProgress(k: number, elapsed: number) {
  const start = k * STAGE_LAG
  return Math.max(0, Math.min(1, (elapsed - start) / SEGMENT_MS))
}

export function Library() {
  const { field, ingest, setIngest } = useApp()
  const [elapsed, setElapsed] = useState(ingest.phase === 'done' ? Infinity : ingest.phase === 'running' ? performance.now() - ingest.startedAt : 0)
  const [hover, setHover] = useState<{ clip: Clip; rect: Rect } | null>(null)

  // place tiles for the current ingest phase
  useEffect(() => {
    field.setFocus(null)
    field.setSlots(cells, 1)
    field.interactive = true
    field.onHover = (clip, rect) => setHover(clip && rect ? { clip, rect } : null)
    field.onClick = null
    const t = new Map<string, TileTarget>()
    if (ingest.phase === 'idle') {
      const hidden = new Map<string, Rect & { alpha: number }>()
      ingestOrder.forEach((c, i) => {
        const r = cells[i]
        hidden.set(c.clip_id, { x: r.x + r.w * 0.1, y: r.y + r.h * 0.1, w: r.w * 0.8, h: r.h * 0.8, alpha: 0 })
      })
      field.place(hidden)
    } else if (ingest.phase === 'done') {
      ingestOrder.forEach((c, i) => t.set(c.clip_id, { ...cells[i], alpha: 1, dur: 900, delay: (i % GRID_COLS) * 8 }))
      field.setTargets(t)
    }
    return () => {
      field.onHover = null
      field.interactive = false
      field.setSlots([], 0)
    }
  }, [field, ingest.phase])

  // drive the replay
  useEffect(() => {
    if (ingest.phase !== 'running') return
    const startedAt = ingest.startedAt
    const now = performance.now() - startedAt
    const t = new Map<string, TileTarget>()
    ingestOrder.forEach((c, i) => {
      const appear = (i / ingestOrder.length) * SEGMENT_MS
      t.set(c.clip_id, { ...cells[i], alpha: 1, delay: Math.max(0, appear - now), dur: 520 })
    })
    field.setTargets(t)
    let raf = 0
    const tick = () => {
      const e = performance.now() - startedAt
      setElapsed(e)
      if (e > SEGMENT_MS + STAGE_LAG * 4 + 200) setIngest({ phase: 'done', startedAt })
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [field, ingest, setIngest])

  useKeys({
    ' ': () => {
      if (ingest.phase === 'idle') setIngest({ phase: 'running', startedAt: performance.now() })
    },
    r: () => {
      setElapsed(0)
      setIngest({ phase: 'idle', startedAt: 0 })
    },
  })

  const ingested = Math.round(stageProgress(0, elapsed) * ingestOrder.length)
  const stock = library.clips.filter((c) => c.source === 'stock').length
  const ours = library.clips.filter((c) => c.source === 'ours')
  const counts = siteCounts()

  return (
    <div className="absolute inset-0">
      {/* sources */}
      <div className="absolute left-24 top-[152px] flex w-[424px] flex-col gap-6">
        <SourceCard title="Stock archive" count={stock} unit="clips" sub={`${library.sites.filter((s) => s.source === 'stock').length} sites · CCTV, traffic, dashcam`}>
          {library.sites
            .filter((s) => s.source === 'stock')
            .map((s) => (
              <Row key={s.id} clip={library.clips.find((c) => c.location === s.id)} label={s.name} value={counts.get(s.id) ?? 0} />
            ))}
        </SourceCard>
        <SourceCard title="Our recordings" count={ours.length} unit="takes" sub={`${tasks().length} tasks · bench camera`}>
          {tasks().map((t) => (
            <Row key={t.id} clip={ours.find((c) => c.cluster_id === t.id)} label={t.label} value={ours.filter((c) => c.cluster_id === t.id).length} unit="takes" />
          ))}
        </SourceCard>
      </div>

      {/* grid header */}
      <div className="absolute left-[584px] right-24 top-[152px] flex h-10 items-baseline justify-between">
        <div className="flex items-baseline gap-4">
          <span className="text-[22px] font-medium tracking-[-0.01em]">Library</span>
          <span className="tnum font-mono text-[20px] text-ink-2">
            <span className={ingested ? 'text-ink' : ''}>{ingested.toLocaleString('en-US')}</span>
            <span className="text-ink-3"> / {ingestOrder.length}</span> clips
          </span>
        </div>
        <span className="font-mono text-[17px] text-ink-3">Replay of ingest run · {library.ingest.started_at}</span>
      </div>

      <Pipeline stages={library.ingest.stages} elapsed={elapsed} />

      <AnimatePresence>{hover && <HoverCard key={hover.clip.clip_id} clip={hover.clip} rect={hover.rect} />}</AnimatePresence>

    </div>
  )
}

function SourceCard({ title, count, unit, sub, children }: { title: string; count: number; unit: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] border border-line bg-surface px-7 pb-5 pt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[24px] font-medium tracking-[-0.015em]">{title}</h2>
        <span className="tnum font-mono text-[24px] text-ink">
          {count} <span className="text-[18px] text-ink-2">{unit}</span>
        </span>
      </div>
      <p className="mt-1 text-[18px] text-ink-2">{sub}</p>
      <div className="mt-4 flex flex-col">{children}</div>
    </section>
  )
}

function Row({ clip, label, value, unit }: { clip?: Clip; label: string; value: number; unit?: string }) {
  return (
    <div className="flex h-[42px] items-center gap-4 border-t border-line">
      <Thumb clip={clip} size="sm" className="h-[27px] w-[48px] shrink-0 rounded-[4px]" />
      <span className="flex-1 text-[20px] text-ink">{label}</span>
      <span className="tnum font-mono text-[20px] text-ink-2">
        {value}
        {unit && <span className="text-ink-3"> {unit}</span>}
      </span>
    </div>
  )
}

function Pipeline({ stages, elapsed }: { stages: IngestStage[]; elapsed: number }) {
  return (
    <div className="absolute inset-x-24 top-[828px] grid grid-cols-5 border-t border-line pt-7">
      {stages.map((s, k) => {
        const p = stageProgress(k, elapsed)
        const state = p >= 1 ? 'done' : p > 0 ? 'run' : 'idle'
        return (
          <div key={s.id} className="relative pr-10">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[15px] text-ink-3">0{k + 1}</span>
              <span className={`text-[22px] font-medium tracking-[-0.01em] transition-colors duration-500 ${state === 'idle' ? 'text-ink-3' : 'text-ink'}`}>{s.label}</span>
              {s.model && <span className={`font-mono text-[17px] transition-colors duration-500 ${state === 'idle' ? 'text-ink-3' : 'text-ink-2'}`}>{s.model}</span>}
            </div>
            <div className="mt-3 flex items-baseline gap-2.5">
              <span className={`tnum font-mono text-[44px] font-light leading-none tracking-[-0.03em] transition-colors duration-500 ${state === 'idle' ? 'text-ink-3' : 'text-ink'}`}>
                {Math.round(s.total * p).toLocaleString('en-US')}
              </span>
              <span className="text-[18px] text-ink-2">{s.unit}</span>
            </div>
            <div className="relative mt-5 h-[2px] overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-[background-color] duration-500"
                style={{ width: `${p * 100}%`, background: state === 'done' ? '#4BE38A' : '#FFB547' }}
              />
            </div>
            {k < stages.length - 1 && <Chevron active={state !== 'idle'} />}
          </div>
        )
      })}
    </div>
  )
}

function Chevron({ active }: { active: boolean }) {
  return (
    <svg className="absolute right-4 top-1 transition-opacity duration-500" style={{ opacity: active ? 0.55 : 0.2 }} width="12" height="20" viewBox="0 0 12 20">
      <path d="M2 2 L10 10 L2 18" fill="none" stroke="#F4F2EE" strokeWidth="1.5" />
    </svg>
  )
}
