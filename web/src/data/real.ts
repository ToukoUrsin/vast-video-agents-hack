// Real archive adapter. real-archive.json is written by server/build_map.py from the team's
// VSS index (VastDB rows: Cosmos Reason captions, YOLO classes, Cosmos Embed vectors -> UMAP
// layout + k-means clusters named by the W&B LLM). Same LibraryData shape as placeholder.ts.
import type { LibraryData } from './types'
import realArchive from './real-archive.json'

export interface RealMeta {
  generated_at: string
  videos: number
  segments: number
  shown_clips: number
  layout: string
  clustering: string
  label_model: string | null
}

export const REAL_ARCHIVE = realArchive as unknown as Partial<LibraryData> & { meta?: RealMeta }

/**
 * Source-aware merge: archive ('stock') items come from `real`; our task recordings ('ours')
 * stay from `base` until `real` contains our own uploaded takes, then those win too.
 */
export function mergeReal(base: LibraryData, real: Partial<LibraryData>): LibraryData {
  const pick = <T extends { source: string }>(b: T[], r: T[] | undefined): T[] => {
    if (!r?.length) return b
    if (r.some((x) => x.source === 'ours')) return r
    return [...r.filter((x) => x.source !== 'ours'), ...b.filter((x) => x.source === 'ours')]
  }
  // Real VSS-indexed takes win, but keep hand-written bits from base where ids/text match:
  // curated take captions and per-step corrections (common_mistake) stay authoritative.
  const baseClip = new Map(base.clips.map((c) => [c.clip_id, c]))
  const baseStep = new Map(base.clusters.flatMap((k) => k.steps.map((s) => [`${k.id}|${s.text}`, s] as const)))
  const clips = pick(base.clips, real.clips).map((c) => {
    const b = c.source === 'ours' ? baseClip.get(c.clip_id) : undefined
    return b ? { ...c, caption: b.caption || c.caption } : c
  })
  const clusters = pick(base.clusters, real.clusters).map((k) =>
    k.source !== 'ours'
      ? k
      : {
          ...k,
          steps: k.steps.map((s) => {
            const b = baseStep.get(`${k.id}|${s.text}`)
            return b ? { ...b, ...s, common_mistake: s.common_mistake ?? b.common_mistake } : s
          }),
        },
  )
  return {
    sites: pick(base.sites, real.sites),
    clips,
    clusters,
    ingest: real.ingest ?? base.ingest,
  }
}

/** `?data=placeholder` in the URL forces the seeded placeholders (rehearsal / offline). */
export const usePlaceholder = () =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('data') === 'placeholder'
