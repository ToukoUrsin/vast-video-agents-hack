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
  return {
    sites: pick(base.sites, real.sites),
    clips: pick(base.clips, real.clips),
    clusters: pick(base.clusters, real.clusters),
    ingest: real.ingest ?? base.ingest,
  }
}

/** `?data=placeholder` in the URL forces the seeded placeholders (rehearsal / offline). */
export const usePlaceholder = () =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('data') === 'placeholder'
