// Single entry point for app data. Today: seeded placeholders. Later: fetch from our
// server proxy (VastDB rows) and keep the same LibraryData shape.
import { PLACEHOLDER } from './placeholder'
import type { Clip, Cluster, LibraryData } from './types'

export * from './types'

export const library: LibraryData = PLACEHOLDER

const clipIndex = new Map(library.clips.map((c) => [c.clip_id, c]))
const clusterIndex = new Map(library.clusters.map((c) => [c.id, c]))

export const getClip = (id: string): Clip | undefined => clipIndex.get(id)
export const getCluster = (id: string): Cluster | undefined => clusterIndex.get(id)
export const tasks = () => library.clusters.filter((c) => c.source === 'ours')

export function siteCounts() {
  const counts = new Map<string, number>()
  for (const c of library.clips) counts.set(c.location, (counts.get(c.location) ?? 0) + 1)
  return counts
}

/** Ingest order for the replay: deterministic shuffle so sources and sites interleave. */
export const ingestOrder: Clip[] = (() => {
  const arr = [...library.clips]
  let s = 7
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647
    const j = s % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
})()
