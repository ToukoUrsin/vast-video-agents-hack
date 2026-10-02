import type { Clip, Cluster } from '../data/types'
import type { Rect, TileTarget } from './field'

export function gridCells(n: number, area: Rect, cols: number, gap: number): Rect[] {
  const w = (area.w - gap * (cols - 1)) / cols
  const h = (w * 9) / 16
  const cells: Rect[] = []
  for (let i = 0; i < n; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    cells.push({ x: area.x + c * (w + gap), y: area.y + r * (h + gap), w, h })
  }
  return cells
}

export function gridLayout(order: Clip[], area: Rect, cols: number, gap: number) {
  const cells = gridCells(order.length, area, cols, gap)
  const m = new Map<string, Rect>()
  order.forEach((c, i) => m.set(c.clip_id, cells[i]))
  return m
}

/** Grid that fits n tiles into area as large as possible, centred. */
export function fitGrid(order: Clip[], area: Rect, gap: number) {
  const n = order.length
  let best = { cols: 1, w: 0 }
  for (let cols = 8; cols < 60; cols++) {
    const rows = Math.ceil(n / cols)
    const w = Math.min((area.w - gap * (cols - 1)) / cols, ((area.h - gap * (rows - 1)) / rows) * (16 / 9))
    if (w > best.w) best = { cols, w }
  }
  const rows = Math.ceil(n / best.cols)
  const h = (best.w * 9) / 16
  const W = best.cols * best.w + gap * (best.cols - 1)
  const H = rows * h + gap * (rows - 1)
  return gridLayout(order, { x: area.x + (area.w - W) / 2, y: area.y + (area.h - H) / 2, w: W, h: H }, best.cols, gap)
}

export interface ClusterGeom {
  id: string
  label: string
  source: 'stock' | 'ours'
  tint: string
  cx: number
  cy: number
  box: Rect
  count: number
  order: number
}

export interface TakeChip {
  clip: Clip
  rect: Rect
  sloppy: boolean
}

export interface MapLayout {
  targets: Map<string, TileTarget>
  clusters: ClusterGeom[]
  chips: TakeChip[]
  /** ms after which each cluster has settled */
  settleAt: Map<string, number>
}

const ARCHIVE_TILE = { w: 38, h: 21.4, gap: 3 }
const TAKE_TILE = { w: 136, h: 76.5, gap: 8 }
const NOISE_TILE = { w: 24, h: 13.5 }

export function clusterLayout(
  clips: Clip[],
  clusters: Cluster[],
  area: Rect,
  opts: { stagger: number; dur: number; animate: boolean },
): MapLayout {
  const byCluster = new Map<string, Clip[]>()
  const noise: Clip[] = []
  for (const c of clips) {
    if (c.cluster_id && clusters.some((k) => k.id === c.cluster_id)) {
      if (!byCluster.has(c.cluster_id)) byCluster.set(c.cluster_id, [])
      byCluster.get(c.cluster_id)!.push(c)
    } else noise.push(c)
  }

  // centroids in embedding space -> stage space
  const cents = clusters
    .filter((k) => byCluster.has(k.id))
    .map((k) => {
      const list = byCluster.get(k.id)!
      const x = list.reduce((s, c) => s + c.embedding2d.x, 0) / list.length
      const y = list.reduce((s, c) => s + c.embedding2d.y, 0) / list.length
      return { k, x, y, list }
    })
  const xs = cents.map((c) => c.x)
  const ys = cents.map((c) => c.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padX = 210
  const padY = 150
  const sx = (v: number) => area.x + padX + ((v - minX) / (maxX - minX || 1)) * (area.w - padX * 2)
  const sy = (v: number) => area.y + padY + ((v - minY) / (maxY - minY || 1)) * (area.h - padY * 2)
  const nx = (v: number) => sx(v)
  const ny = (v: number) => sy(v)

  const targets = new Map<string, TileTarget>()
  const geoms: ClusterGeom[] = []
  const chips: TakeChip[] = []
  const settleAt = new Map<string, number>()

  // stagger order: our tasks first (the story), then archive by size
  const ordered = [...cents].sort((a, b) => {
    if (a.k.source !== b.k.source) return a.k.source === 'ours' ? -1 : 1
    return b.list.length - a.list.length
  })

  // 1. local tile arrangement per cluster, relative to (0, 0)
  const locals = ordered.map(({ k, x, y, list }) => {
    const rects: Array<{ clip: Clip; r: Rect; alpha: number; sloppy?: boolean }> = []
    if (k.source === 'ours') {
      const sorted = [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      const { w, h, gap } = TAKE_TILE
      sorted.forEach((clip, i) => {
        const sloppy = (clip.score ?? 100) < 70
        let r: Rect
        if (i === 0) r = { x: -w - gap / 2, y: -h / 2, w, h }
        else if (i === 1) r = { x: gap / 2, y: -h / 2, w, h }
        else {
          // weaker takes drift to the edge, smaller
          const sw = w * 0.76
          const sh = h * 0.76
          r = { x: w + gap * 5 + (i - 2) * (sw + gap), y: h / 2 - sh + 22, w: sw, h: sh }
        }
        rects.push({ clip, r, alpha: sloppy ? 0.4 : 1, sloppy })
      })
    } else {
      const { w, h, gap } = ARCHIVE_TILE
      const n = list.length
      const R = Math.ceil(Math.sqrt(n)) + 2
      const cells: Array<{ x: number; y: number; d: number }> = []
      for (let r = -R; r <= R; r++)
        for (let c = -R; c <= R; c++) {
          const ox = r % 2 === 0 ? 0 : (w + gap) / 2
          const px = c * (w + gap) + ox
          const py = r * (h + gap)
          cells.push({ x: px, y: py, d: Math.hypot(px / 1.3, py) })
        }
      cells.sort((a, b) => a.d - b.d)
      const sorted = [...list].sort(
        (a, b) => Math.hypot(a.embedding2d.x - x, a.embedding2d.y - y) - Math.hypot(b.embedding2d.x - x, b.embedding2d.y - y),
      )
      sorted.forEach((clip, i) => {
        const cell = cells[i]
        rects.push({ clip, r: { x: cell.x - w / 2, y: cell.y - h / 2, w, h }, alpha: 1 })
      })
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const { r } of rects) {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y)
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h)
    }
    // reserve room for the label under the cluster
    const box = { x0, y0, x1, y1: y1 + 52 }
    return { k, list, rects, box, cx: sx(x), cy: sy(y) }
  })

  // 2. push overlapping clusters apart (works for any real embedding too)
  const M = 56
  for (let it = 0; it < 400; it++) {
    let moved = false
    for (let i = 0; i < locals.length; i++)
      for (let j = i + 1; j < locals.length; j++) {
        const a = locals[i], b = locals[j]
        const ox = Math.min(a.cx + a.box.x1, b.cx + b.box.x1) - Math.max(a.cx + a.box.x0, b.cx + b.box.x0) + M
        const oy = Math.min(a.cy + a.box.y1, b.cy + b.box.y1) - Math.max(a.cy + a.box.y0, b.cy + b.box.y0) + M
        if (ox > 0 && oy > 0) {
          moved = true
          if (ox < oy) {
            const d = (ox / 2 + 0.5) * (a.cx < b.cx ? -1 : 1)
            a.cx += d; b.cx -= d
          } else {
            const d = (oy / 2 + 0.5) * (a.cy < b.cy ? -1 : 1)
            a.cy += d; b.cy -= d
          }
        }
      }
    for (const l of locals) {
      l.cx = Math.max(area.x - l.box.x0, Math.min(area.x + area.w - l.box.x1, l.cx))
      l.cy = Math.max(area.y - l.box.y0, Math.min(area.y + area.h - l.box.y1, l.cy))
    }
    if (!moved) break
  }

  // 3. targets
  locals.forEach(({ k, list, rects, cx, cy }, idx) => {
    const delay = opts.animate ? idx * opts.stagger : 0
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    rects.forEach(({ clip, r: lr, alpha, sloppy }, i) => {
      const r = { x: cx + lr.x, y: cy + lr.y, w: lr.w, h: lr.h }
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y)
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h)
      const jitter = opts.animate ? (i / rects.length) * 260 : 0
      targets.set(clip.clip_id, {
        ...r,
        alpha,
        delay: delay + jitter,
        dur: opts.dur,
        arc: opts.animate ? (idx % 2 ? 1 : -1) * 40 : 0,
      })
      if (k.source === 'ours') chips.push({ clip, rect: r, sloppy: !!sloppy })
    })
    settleAt.set(k.id, delay + 260 + opts.dur * 0.75)
    // label anchors on the two main takes, not the drifted weak take
    const main = k.source === 'ours' ? { x0: cx - TAKE_TILE.w - TAKE_TILE.gap / 2, x1: cx + TAKE_TILE.w + TAKE_TILE.gap / 2 } : { x0, x1 }
    geoms.push({
      id: k.id,
      label: k.label,
      source: k.source,
      tint: k.tint,
      cx,
      cy,
      box: { x: main.x0, y: y0, w: main.x1 - main.x0, h: k.source === 'ours' ? TAKE_TILE.h : y1 - y0 },
      count: list.length,
      order: idx,
    })
  })

  // noise: dim, small, pushed out of cluster boxes
  const noiseDelay = opts.animate ? ordered.length * opts.stagger : 0
  noise.forEach((clip, i) => {
    let x = nx(clip.embedding2d.x)
    let y = ny(clip.embedding2d.y)
    x = Math.max(area.x + 40, Math.min(area.x + area.w - 60, x))
    y = Math.max(area.y + 40, Math.min(area.y + area.h - 40, y))
    for (const g of geoms) {
      const m = 28
      const b = { x: g.box.x - m, y: g.box.y - m, w: g.box.w + 2 * m, h: g.box.h + 2 * m + 56 }
      if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) {
        const dx = x - (b.x + b.w / 2)
        const dy = y - (b.y + b.h / 2)
        if (Math.abs(dx) / b.w > Math.abs(dy) / b.h) x = dx > 0 ? b.x + b.w + 4 : b.x - NOISE_TILE.w - 4
        else y = dy > 0 ? b.y + b.h + 4 : b.y - NOISE_TILE.h - 4
      }
    }
    x = Math.max(area.x, Math.min(area.x + area.w - NOISE_TILE.w, x))
    y = Math.max(area.y, Math.min(area.y + area.h - NOISE_TILE.h, y))
    // never sit on a label or inside a cluster
    const blocked = geoms.some((g) => {
      const lw = g.label.length * (g.source === 'ours' ? 13 : 11) + 110
      const lx = g.box.x + g.box.w / 2 - lw / 2 - 16
      const ly = g.box.y + g.box.h
      return (
        (x + NOISE_TILE.w > lx && x < lx + lw + 32 && y + NOISE_TILE.h > ly && y < ly + 64) ||
        (x + NOISE_TILE.w > g.box.x - 8 && x < g.box.x + g.box.w + 8 && y + NOISE_TILE.h > g.box.y - 8 && y < g.box.y + g.box.h + 8)
      )
    })
    targets.set(clip.clip_id, {
      x,
      y,
      ...NOISE_TILE,
      alpha: blocked ? 0 : 0.32,
      delay: noiseDelay + (opts.animate ? (i / noise.length) * 300 : 0),
      dur: opts.dur,
    })
  })

  return { targets, clusters: geoms, chips, settleAt }
}
