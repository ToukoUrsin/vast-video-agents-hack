// Single entry point for app data. Real VSS archive (real-archive.json, from server/build_map.py)
// merged with placeholder task takes; public/data/library.json, if present, overrides that.
// ?data=placeholder forces the seeded placeholders.
import { PLACEHOLDER } from './placeholder'
import { mergeReal, REAL_ARCHIVE, usePlaceholder } from './real'
import type { Clip, Cluster, LibraryData } from './types'

export * from './types'

async function load(): Promise<LibraryData> {
  if (usePlaceholder()) return PLACEHOLDER
  const base = mergeReal(PLACEHOLDER, REAL_ARCHIVE)
  try {
    const res = await fetch('/data/library.json', { cache: 'no-store' })
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      const real = (await res.json()) as Partial<LibraryData>
      console.info('[understudy] using public/data/library.json')
      return mergeReal(base, real)
    }
  } catch {
    // fall through to the bundled snapshot
  }
  return base
}

export const library: LibraryData = await load()

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
