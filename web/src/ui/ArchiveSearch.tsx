// "Ask the archive": live VAST semantic search (POST /api/search -> VSS /api/v1/search, Cosmos Embed
// query vector over VastDB). Results list on the right; matching tiles light up on the map.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { getClip, library } from '../data'

export interface SearchHit {
  source: string
  caption: string
  location: string | null
  camera_id: string | null
  similarity: number
  start_s: number | null
  end_s: number | null
  task: string | null
  take: string | null
  clip_id: string | null
  on_map: 'exact' | 'same video' | null
  thumb: string
}

interface SearchResponse {
  query: string
  results: SearchHit[]
  total?: number
  embedding_ms?: number
  search_ms?: number
  latency_ms?: number
  error?: string
  fix?: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string; t0: number }
  | { kind: 'done'; res: SearchResponse; ms: number }
  | { kind: 'error'; message: string; fix?: string }

const EXAMPLES = ['person swapping bottle caps', 'forklift near a person', 'people crossing at a crosswalk']

export function ArchiveSearch({ onClose, onHits, focusKey }: { onClose: () => void; onHits: (ids: string[]) => void; focusKey: number }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 60)
    return () => clearTimeout(id)
  }, [focusKey])

  const run = async (q: string) => {
    q = q.trim()
    if (!q) return
    setQuery(q)
    const my = ++seq.current
    const t0 = performance.now()
    setStatus({ kind: 'loading', query: q, t0 })
    onHits([])
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, top_k: 8 }),
      })
      const j = (await res.json().catch(() => ({}))) as SearchResponse
      if (my !== seq.current) return
      if (!res.ok || j.error) {
        setStatus({ kind: 'error', message: j.error || `Server error ${res.status}`, fix: j.fix })
        return
      }
      setStatus({ kind: 'done', res: j, ms: performance.now() - t0 })
      onHits(j.results.map((r) => r.clip_id).filter((x): x is string => !!x))
    } catch (e) {
      if (my !== seq.current) return
      const msg = (e as Error).message
      setStatus({ kind: 'error', message: msg === 'Failed to fetch' ? 'Understudy server unreachable' : msg })
    }
  }

  return (
    <motion.aside
      className="pointer-events-auto absolute bottom-6 right-6 top-[120px] flex w-[720px] flex-col rounded-[24px] border border-line bg-surface px-10 pt-9"
      initial={{ x: 760, opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 760, opacity: 0.6 }}
      transition={{ type: 'spring', stiffness: 260, damping: 34 }}
    >
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[16px] text-ink-2">VAST semantic search · Cosmos Embed</p>
        <button onClick={onClose} className="font-mono text-[15px] text-ink-3 hover:text-ink-2">
          Esc
        </button>
      </div>

      <form
        className="mt-4 flex items-center gap-4 border-b border-line-strong pb-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(query)
        }}
      >
        <SearchGlyph />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="Ask the archive"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[32px] font-medium tracking-[-0.02em] text-ink caret-go outline-none placeholder:text-ink-3"
        />
        <kbd className="rounded-[6px] border border-line-strong px-2 py-0.5 font-mono text-[14px] text-ink-3">↵</kbd>
      </form>

      <StatusLine status={status} onExample={run} />

      <div className="relative mt-4 min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {status.kind === 'done' && (
            <motion.ol key={status.res.query + status.ms} className="flex flex-col" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              {status.res.results.map((r, i) => (
                <Row key={r.source + i} hit={r} i={i} />
              ))}
              {!status.res.results.length && <p className="mt-6 text-[22px] text-ink-2">Nothing in the archive matches that closely.</p>}
            </motion.ol>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  )
}

function StatusLine({ status, onExample }: { status: Status; onExample: (q: string) => void }) {
  if (status.kind === 'idle')
    return (
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <span className="mr-1 font-mono text-[15px] text-ink-3">Try</span>
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => onExample(q)}
            className="rounded-full border border-line-strong px-3.5 py-1 text-[17px] text-ink-2 transition-colors hover:border-white/25 hover:text-ink"
          >
            {q}
          </button>
        ))}
      </div>
    )
  if (status.kind === 'loading')
    return (
      <div className="mt-5">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-wip opacity-40" style={{ animationDuration: '1.4s' }} />
            <span className="relative h-2.5 w-2.5 rounded-full bg-wip" />
          </span>
          <span className="font-mono text-[16px] text-ink-2">Embedding the question · searching VastDB segments</span>
        </div>
        <div className="mt-3 h-[2px] overflow-hidden rounded-full bg-white/5">
          <motion.div className="h-full bg-wip/80" initial={{ width: '0%' }} animate={{ width: '92%' }} transition={{ duration: 5, ease: [0.2, 0.6, 0.3, 1] }} />
        </div>
      </div>
    )
  if (status.kind === 'error')
    return (
      <div className="mt-5 flex items-start gap-3">
        <span className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full bg-err" />
        <div className="font-mono text-[16px] leading-[1.5]">
          <p className="text-ink">{status.message}</p>
          {status.fix && <p className="text-ink-3">{status.fix}</p>}
        </div>
      </div>
    )
  const r = status.res
  const lit = new Set(r.results.map((x) => x.clip_id).filter(Boolean)).size
  return (
    <div className="tnum mt-5 flex items-center gap-2.5 whitespace-nowrap font-mono text-[16px] text-ink-2">
      <span className="mr-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-go" />
      <span>{r.results.length} segments</span>
      <span className="text-ink-3">·</span>
      <span>embed {r.embedding_ms} ms</span>
      <span className="text-ink-3">·</span>
      <span>search {r.search_ms} ms</span>
      {lit > 0 && (
        <>
          <span className="text-ink-3">·</span>
          <span className="text-go">
            {lit} on the map
          </span>
        </>
      )}
    </div>
  )
}

function Row({ hit, i }: { hit: SearchHit; i: number }) {
  const clip = hit.clip_id ? getClip(hit.clip_id) : undefined
  const ours = !!hit.take
  const where = ours ? `Our take ${hit.take}${clip?.score != null ? ` · rated ${clip.score}` : ''}` : prettyPlace(hit.location)
  const span = hit.start_s != null && hit.end_s != null ? `${fmtS(hit.start_s)}–${fmtS(hit.end_s)}` : null
  return (
    <motion.li
      className="flex h-[86px] items-center gap-5 border-t border-line"
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.04 + i * 0.05, type: 'spring', stiffness: 320, damping: 30 }}
    >
      <div className="relative h-[72px] w-[128px] shrink-0 overflow-hidden rounded-[6px] bg-raised">
        <img src={hit.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => (e.currentTarget.style.opacity = '0')} />
        {hit.clip_id && <span className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-go" title="on the map" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[18px] leading-[1.28] tracking-[-0.005em] text-ink">{hit.caption}</p>
        <p className="mt-1 truncate font-mono text-[14px] text-ink-3">
          <span className="text-ink-2">{where}</span>
          {hit.camera_id ? ` · ${hit.camera_id}` : ''}
          {span ? ` · ${span}` : ''}
        </p>
      </div>
      <div className="w-[64px] shrink-0 text-right">
        <p className="tnum font-mono text-[20px] text-ink">{hit.similarity.toFixed(2)}</p>
        <div className="ml-auto mt-1.5 h-[3px] w-[56px] overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-ink/60" style={{ width: `${Math.min(100, Math.max(6, hit.similarity * 160))}%` }} />
        </div>
      </div>
    </motion.li>
  )
}

function SearchGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="#8C8A86" strokeWidth="2" />
      <path d="M15.5 15.5 L21 21" stroke="#8C8A86" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// VSS location values -> the site names the Library screen uses
const ALIAS: Record<string, string> = { san_francisco: 'sf', understudy: 'studio' }
function prettyPlace(loc: string | null) {
  if (!loc) return 'Archive'
  const id = ALIAS[loc] ?? (loc.startsWith('warehouse') ? 'warehouse' : loc)
  return library.sites.find((s) => s.id === id)?.name ?? loc.replace(/[_-]+/g, ' ')
}

const fmtS = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
