// Procedural placeholder frames: dark, low-contrast scene silhouettes with grain, so the UI
// reads like real CCTV/dashcam footage until real thumbnails land in public/clips/.
import type { Clip, SceneKind } from '../data/types'
import { getSiteKind } from './siteKind'
import { hashString, mulberry32 } from './rng'

type Ctx = CanvasRenderingContext2D
type R = () => number

export const THUMB_SM = { w: 192, h: 108 }
export const THUMB_LG = { w: 640, h: 360 }

const cache = new Map<string, HTMLCanvasElement | HTMLImageElement>()
const listeners = new Set<() => void>()
export const onThumbsChange = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** variant > 0 renders another moment of the same placeholder scene (e.g. a later step). */
export function getThumb(clip: Clip, size: 'sm' | 'lg' = 'sm', variant = 0): HTMLCanvasElement | HTMLImageElement {
  const key = `${clip.clip_id}:${size}:${variant}`
  const hit = cache.get(key)
  if (hit) return hit
  const dim = size === 'sm' ? THUMB_SM : THUMB_LG
  const sloppy = clip.source === 'ours' && (clip.score ?? 100) < 70
  // variant N > 0 on a task scene = the state right after step N
  const canvas = renderScene(sceneFor(clip), dim.w, dim.h, hashString(clip.clip_id) + variant * 7919, {
    step: variant > 0 ? variant : undefined,
    sloppy: variant > 0 ? false : sloppy,
  })
  cache.set(key, canvas)
  if (clip.thumbnail_url) {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      cache.set(key, img)
      listeners.forEach((l) => l())
    }
    img.src = clip.thumbnail_url
  }
  return canvas
}

export function sceneFor(clip: Clip): SceneKind {
  if (clip.source === 'ours') {
    if (clip.cluster_id === 'cup-pyramid') return 'task-cups'
    if (clip.cluster_id === 'vast-astronaut') return 'task-astro'
    return 'task-caps'
  }
  return getSiteKind(clip.location)
}

export interface SceneOpts {
  step?: number
  sloppy?: boolean
}

export function renderScene(kind: SceneKind, w: number, h: number, seed: number, opts: SceneOpts = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const rand = mulberry32(seed)
  ctx.save()
  ctx.scale(w / 192, h / 108)
  const warm = kind.startsWith('task')
  const temp = warm ? 0.6 + rand() * 0.4 : rand() * 2 - 1 // -1 cool .. 1 warm
  base(ctx, temp, kind, rand)
  SCENES[kind](ctx, rand, opts)
  ctx.restore()
  grade(ctx, w, h, temp, rand, warm)
  return canvas
}

function tint(temp: number, l: number, a = 1) {
  // near-neutral grey nudged warm or cool
  const r = Math.round(l + temp * 6)
  const g = Math.round(l + Math.abs(temp) * 1)
  const b = Math.round(l - temp * 6)
  return `rgba(${r},${g},${b},${a})`
}

function base(ctx: Ctx, temp: number, kind: SceneKind, rand: R) {
  const lift = kind.startsWith('task') ? 10 : kind === 'indoor' || kind === 'warehouse' ? 4 : 0
  const g = ctx.createLinearGradient(0, 0, 0, 108)
  g.addColorStop(0, tint(temp, 30 + lift + rand() * 8))
  g.addColorStop(0.55, tint(temp, 20 + lift))
  g.addColorStop(1, tint(temp, 13 + lift * 0.6))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 192, 108)
}

const W = (a: number) => `rgba(236,232,224,${a})`
const K = (a: number) => `rgba(4,4,6,${a})`

function poly(ctx: Ctx, pts: number[], fill: string) {
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.strokeStyle = stroke
  ctx.lineWidth = w
  ctx.stroke()
}

function glow(ctx: Ctx, x: number, y: number, r: number, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, W(a))
  g.addColorStop(1, W(0))
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

function person(ctx: Ctx, x: number, y: number, s: number, a: number) {
  ctx.fillStyle = W(a)
  ctx.beginPath()
  ctx.arc(x, y - 15 * s, 3.2 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.roundRect(x - 4 * s, y - 11 * s, 8 * s, 12 * s, 2.5 * s)
  ctx.fill()
  ctx.fillRect(x - 3.4 * s, y, 2.6 * s, 10 * s)
  ctx.fillRect(x + 0.8 * s, y, 2.6 * s, 10 * s)
}

const SCENES: Record<SceneKind, (ctx: Ctx, r: R, o: SceneOpts) => void> = {
  warehouse(ctx, r) {
    const vx = 80 + r() * 32
    const vy = 40 + r() * 8
    poly(ctx, [0, 108, 192, 108, vx + 14, vy + 4, vx - 14, vy + 4], K(0.25))
    // racks
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 0 : 192
      for (let k = 0; k < 4; k++) {
        const t = k / 4
        const y = 8 + t * 70
        line(ctx, x0, y, vx + side * 16, vy - 6 + t * 10, W(0.07), 1)
      }
      for (let k = 0; k < 7; k++) {
        const t = Math.pow(k / 7, 1.4)
        const x = x0 + (vx + side * 16 - x0) * t
        line(ctx, x, 4 + t * 30, x, 100 - t * 50, W(0.06 + t * 0.04), 1.2 - t * 0.6)
      }
      // boxes on shelves
      for (let k = 0; k < 10; k++) {
        const t = r() * 0.8
        const x = x0 + (vx + side * 16 - x0) * t
        const y = 14 + r() * 50 * (1 - t * 0.6)
        ctx.fillStyle = W(0.05 + r() * 0.05)
        ctx.fillRect(x - 5 * (1 - t), y, 9 * (1 - t) + 1, 6 * (1 - t) + 1)
      }
    }
    for (let k = 0; k < 5; k++) {
      const t = k / 5
      const x = vx + (r() - 0.5) * 6
      glow(ctx, x + (96 - x) * (1 - t) * 0.1, 4 + t * 26, 10 - t * 7, 0.18)
    }
    // forklift
    if (r() < 0.75) {
      const x = 50 + r() * 90
      const y = 70 + r() * 14
      ctx.fillStyle = W(0.16)
      ctx.fillRect(x, y, 18, 10)
      ctx.fillRect(x + 18, y - 18, 2, 28)
      ctx.fillStyle = W(0.1)
      ctx.fillRect(x + 20, y - 6 - r() * 8, 12, 7)
      ctx.fillStyle = K(0.6)
      ctx.beginPath()
      ctx.arc(x + 4, y + 11, 3, 0, 7)
      ctx.arc(x + 14, y + 11, 3, 0, 7)
      ctx.fill()
    } else person(ctx, 60 + r() * 70, 74, 1.1, 0.16)
  },
  highway(ctx, r) {
    const skew = (r() - 0.5) * 40
    poly(ctx, [-20, 108, 212, 108, 120 + skew, 0, 70 + skew, 0], W(0.045))
    for (let lane = 1; lane < 4; lane++) {
      const xb = -20 + (232 * lane) / 4
      const xt = 70 + skew + (50 * lane) / 4
      for (let d = 0; d < 9; d++) {
        const t0 = d / 9
        const t1 = t0 + 0.05
        line(ctx, xb + (xt - xb) * t0, 108 - 108 * t0, xb + (xt - xb) * t1, 108 - 108 * t1, W(0.18 - t0 * 0.1), 1.4 - t0)
      }
    }
    line(ctx, -20, 108, 70 + skew, 0, W(0.12), 1)
    line(ctx, 212, 108, 120 + skew, 0, W(0.12), 1)
    const n = 4 + Math.floor(r() * 6)
    for (let i = 0; i < n; i++) {
      const t = r() * 0.85
      const lane = Math.floor(r() * 4)
      const xb = -20 + (232 * (lane + 0.5)) / 4
      const xt = 70 + skew + (50 * (lane + 0.5)) / 4
      const x = xb + (xt - xb) * t
      const y = 108 - 108 * t
      const s = 1 - t * 0.75
      const truck = r() < 0.35
      ctx.fillStyle = W(0.14 + r() * 0.14)
      ctx.beginPath()
      ctx.roundRect(x - 6 * s, y - (truck ? 20 : 10) * s, 12 * s, (truck ? 20 : 10) * s, 1.5 * s)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,170,150,0.35)'
      ctx.fillRect(x - 5 * s, y - 1.2 * s, 2 * s, 1.2 * s)
      ctx.fillRect(x + 3 * s, y - 1.2 * s, 2 * s, 1.2 * s)
    }
  },
  dashcam(ctx, r) {
    const hz = 46 + r() * 8
    const vx = 86 + r() * 20
    ctx.fillStyle = W(0.03)
    ctx.fillRect(0, 0, 192, hz)
    for (let i = 0; i < 9; i++) {
      const left = i < 5
      const x = left ? i * 16 - r() * 6 : 110 + (i - 5) * 22
      const bw = 14 + r() * 16
      const bh = 14 + r() * 30
      ctx.fillStyle = W(0.04 + r() * 0.04)
      ctx.fillRect(x, hz - bh, bw, bh)
      for (let k = 0; k < 6; k++) {
        if (r() < 0.4) {
          ctx.fillStyle = 'rgba(255,214,160,0.18)'
          ctx.fillRect(x + 2 + r() * (bw - 4), hz - bh + 3 + r() * (bh - 6), 1.5, 1.5)
        }
      }
    }
    poly(ctx, [0, 108, 192, 108, vx + 4, hz, vx - 4, hz], K(0.35))
    for (let d = 0; d < 6; d++) {
      const t0 = d / 6
      line(ctx, vx + (96 - vx) * (1 - t0) * 0, hz + (108 - hz) * t0, vx, hz + (108 - hz) * (t0 + 0.06), W(0.16), 1 + t0)
    }
    if (r() < 0.7) {
      const t = 0.2 + r() * 0.4
      const x = vx + (r() - 0.5) * 50 * t
      const y = hz + (108 - hz) * t
      ctx.fillStyle = W(0.14)
      ctx.fillRect(x - 10 * t * 2, y - 8 * t * 2, 20 * t * 2, 8 * t * 2)
      ctx.fillStyle = 'rgba(255,160,140,0.45)'
      ctx.fillRect(x - 9 * t * 2, y - 3 * t * 2, 3 * t * 2, 1.5 * t * 2)
      ctx.fillRect(x + 6 * t * 2, y - 3 * t * 2, 3 * t * 2, 1.5 * t * 2)
    }
    if (r() < 0.5) person(ctx, 30 + r() * 40, hz + 20, 0.8, 0.14)
    // hood
    ctx.fillStyle = K(0.85)
    ctx.beginPath()
    ctx.moveTo(0, 108)
    ctx.quadraticCurveTo(96, 86, 192, 108)
    ctx.fill()
    line(ctx, 30, 101, 162, 101, W(0.05), 1)
  },
  street(ctx, r) {
    const hz = 58 + r() * 6
    ctx.fillStyle = W(0.025)
    ctx.fillRect(0, hz, 192, 108 - hz)
    let x = -10 - r() * 20
    while (x < 200) {
      const hw = 30 + r() * 18
      const hh = 16 + r() * 8
      const roof = 10 + r() * 8
      poly(ctx, [x, hz, x, hz - hh, x + hw / 2, hz - hh - roof, x + hw, hz - hh, x + hw, hz], W(0.06 + r() * 0.04))
      if (r() < 0.6) {
        ctx.fillStyle = 'rgba(255,214,160,0.22)'
        ctx.fillRect(x + hw * 0.25, hz - hh * 0.7, 4, 4)
      }
      if (r() < 0.5) {
        ctx.fillStyle = K(0.35)
        ctx.beginPath()
        ctx.arc(x + hw + 4, hz - 14, 9 + r() * 5, 0, 7)
        ctx.fill()
      }
      x += hw + 6 + r() * 10
    }
    ctx.fillStyle = K(0.3)
    ctx.fillRect(0, 84, 192, 24)
    line(ctx, 0, 84, 192, 84, W(0.1), 1)
    if (r() < 0.8) {
      const cx = 20 + r() * 140
      ctx.fillStyle = W(0.16)
      ctx.beginPath()
      ctx.roundRect(cx, 88, 34, 9, 3)
      ctx.roundRect(cx + 7, 82, 18, 8, 3)
      ctx.fill()
      ctx.fillStyle = K(0.7)
      ctx.beginPath()
      ctx.arc(cx + 8, 98, 3, 0, 7)
      ctx.arc(cx + 26, 98, 3, 0, 7)
      ctx.fill()
    }
  },
  city(ctx, r) {
    const tilt = (r() - 0.5) * 18
    let x = -6
    while (x < 200) {
      const bw = 16 + r() * 22
      const bh = 40 + r() * 50
      const y0 = 70 - bh + tilt * (x / 192)
      ctx.fillStyle = W(0.045 + r() * 0.04)
      ctx.fillRect(x, y0, bw, bh + 40)
      for (let wy = y0 + 4; wy < 66; wy += 6)
        for (let wx = x + 3; wx < x + bw - 3; wx += 5)
          if (r() < 0.22) {
            ctx.fillStyle = r() < 0.5 ? 'rgba(255,214,170,0.2)' : W(0.1)
            ctx.fillRect(wx, wy, 2, 2.5)
          }
      x += bw + 2
    }
    poly(ctx, [0, 74 + tilt * 0.2, 192, 74 - tilt * 0.2, 192, 108, 0, 108], K(0.45))
    for (let s = 0; s < 8; s++) {
      const sx = 40 + s * 14
      poly(ctx, [sx, 84, sx + 7, 84, sx + 9, 100, sx + 1, 100], W(0.1))
    }
    const n = 1 + Math.floor(r() * 4)
    for (let i = 0; i < n; i++) person(ctx, 40 + r() * 120, 82, 0.9 + r() * 0.3, 0.16 + r() * 0.06)
  },
  indoor(ctx, r) {
    const cx = 70 + r() * 50
    poly(ctx, [0, 0, cx, 18, cx, 70, 0, 100], W(0.03))
    poly(ctx, [192, 0, cx, 18, cx, 70, 192, 96], W(0.05))
    poly(ctx, [0, 100, cx, 70, 192, 96, 192, 108, 0, 108], K(0.25))
    for (let i = 0; i < 3; i++) glow(ctx, 40 + i * 55 + r() * 10, 6 + r() * 4, 14, 0.14)
    ctx.fillStyle = W(0.09)
    ctx.fillRect(cx + 16, 66, 46, 3)
    ctx.fillRect(cx + 18, 69, 2, 14)
    ctx.fillRect(cx + 58, 69, 2, 14)
    const n = 1 + Math.floor(r() * 2)
    for (let i = 0; i < n; i++) person(ctx, 30 + r() * 130, 74 + r() * 8, 1.4, 0.15)
  },
  'task-caps'(ctx, r, o) {
    floor(ctx, r)
    const step = o.step ?? 5
    // sloppy take: bottles swapped, but each cap went back on its own bottle
    const swapped = o.sloppy || step >= 3
    const mdCap = o.sloppy ? 'green' : step >= 5 ? 'black' : step >= 1 ? null : 'green'
    const cokeCap = o.sloppy ? 'black' : step >= 4 ? 'green' : step >= 2 ? null : 'black'
    const xl = 74 + r() * 4
    const xr = 118 + r() * 4
    const bottle = (x: number, kind: 'md' | 'coke', cap: string | null) => {
      const body = kind === 'md' ? 'rgba(95,170,90,0.75)' : 'rgba(92,52,42,0.95)'
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.roundRect(x - 8, 58, 16, 34, 4)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(x - 8, 60)
      ctx.quadraticCurveTo(x - 6, 50, x - 3, 46)
      ctx.lineTo(x + 3, 46)
      ctx.quadraticCurveTo(x + 6, 50, x + 8, 60)
      ctx.fill()
      ctx.fillRect(x - 3, 41, 6, 6)
      ctx.fillStyle = kind === 'md' ? 'rgba(230,240,120,0.55)' : 'rgba(210,50,45,0.85)'
      ctx.fillRect(x - 8, 68, 16, 9)
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.fillRect(x - 6, 60, 2, 28)
      if (cap) {
        ctx.fillStyle = cap === 'green' ? 'rgba(60,170,70,0.95)' : 'rgba(18,18,18,0.95)'
        ctx.fillRect(x - 4, 37, 8, 5)
      }
    }
    bottle(swapped ? xr : xl, 'md', mdCap)
    bottle(swapped ? xl : xr, 'coke', cokeCap)
    // loose caps on the floor
    const loose = [mdCap === null && 'green', cokeCap === null && 'black'].filter(Boolean) as string[]
    loose.forEach((c, k) => {
      ctx.fillStyle = c === 'green' ? 'rgba(60,170,70,0.95)' : 'rgba(18,18,18,0.95)'
      ctx.beginPath()
      ctx.ellipse(146 + k * 12, 96, 4.5, 2.5, 0, 0, 7)
      ctx.fill()
    })
    hands(ctx, 96, 52)
  },
  'task-cups'(ctx, r, o) {
    floor(ctx, r)
    const step = o.step ?? 3
    const cx = 92 + r() * 10
    const base = 92
    const cup = (x: number, y: number) => {
      // clear plastic: faint fill, bright outline and a highlight
      poly(ctx, [x - 11, y, x + 11, y, x + 8, y - 18, x - 8, y - 18], 'rgba(220,235,245,0.16)')
      ctx.strokeStyle = 'rgba(235,245,255,0.6)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x - 11, y)
      ctx.lineTo(x - 8, y - 18)
      ctx.lineTo(x + 8, y - 18)
      ctx.lineTo(x + 11, y)
      ctx.closePath()
      ctx.stroke()
      line(ctx, x - 6, y - 15, x - 7.5, y - 3, 'rgba(255,255,255,0.45)', 1.2)
    }
    if (step >= 4 && !o.sloppy) {
      for (let k = 0; k < 6; k++) cup(cx, base - k * 3.2)
    } else {
      const bottom = o.sloppy ? 2 : 3
      for (let k = 0; k < bottom; k++) cup(cx + (k - (bottom - 1) / 2) * 24, base)
      if (o.sloppy || step >= 2) {
        const mid = o.sloppy ? 1 : 2
        for (let k = 0; k < mid; k++) cup(cx + (k - (mid - 1) / 2) * 24, base - 19)
      }
      if (!o.sloppy && step >= 3) cup(cx, base - 38)
      const spare = o.sloppy ? 3 : Math.max(0, 6 - (step >= 3 ? 6 : step >= 2 ? 5 : 3))
      for (let k = 0; k < spare; k++) cup(162, base - k * 3.2)
    }
    hands(ctx, cx, base - 52)
  },
  'task-astro'(ctx, r, o) {
    floor(ctx, r)
    const step = o.step ?? 5
    const cx = 96 + r() * 6
    const by = 94
    const has = (n: number) => (o.sloppy ? n !== 3 && n <= 4 : step >= n)
    if (has(1)) {
      ctx.fillStyle = 'rgba(240,240,236,0.8)'
      ctx.beginPath()
      ctx.ellipse(cx, by, 20, 5, 0, 0, 7)
      ctx.fill()
    }
    let top = by - 2
    const white = 'rgba(244,244,240,0.95)'
    if (has(2)) {
      ctx.fillStyle = white
      ctx.fillRect(cx - 7, top - 14, 6, 14)
      ctx.fillRect(cx + 1, top - 14, 6, 14)
      ctx.fillRect(cx - 7, top - 18, 14, 5)
      top -= 18
    }
    if (has(3)) {
      ctx.fillStyle = white
      poly(ctx, [cx - 8, top, cx + 8, top, cx + 6, top - 14, cx - 6, top - 14], white)
      ctx.fillStyle = 'rgba(30,40,80,0.85)' // VAST on the chest
      ctx.fillRect(cx - 4, top - 9, 8, 3)
      ctx.fillStyle = white
      ctx.fillRect(cx - 11, top - 13, 3, 10)
      ctx.fillRect(cx + 8, top - 13, 3, 10)
      top -= 14
    }
    if (has(4)) {
      ctx.fillStyle = white
      ctx.beginPath()
      ctx.arc(cx, top - 7, 8, 0, 7)
      ctx.fill()
      ctx.fillStyle = 'rgba(25,30,45,0.9)'
      ctx.beginPath()
      ctx.roundRect(cx - 5, top - 10, 10, 6, 2)
      ctx.fill()
    }
    if (has(5)) line(ctx, cx + 13, top + 18, cx + 13, top - 16, 'rgba(40,55,110,0.95)', 2)
    // loose parts waiting on the floor
    if (!has(3)) {
      ctx.fillStyle = white
      ctx.fillRect(140, 90, 12, 8)
    }
    if (!has(4)) {
      ctx.fillStyle = white
      ctx.beginPath()
      ctx.arc(160, 92, 5, 0, 7)
      ctx.fill()
    }
    hands(ctx, cx, top - 6)
  },
}

/** Floor shot from a low front camera: wall, floor, the person sitting cross-legged behind. */
function floor(ctx: Ctx, r: R) {
  poly(ctx, [0, 62, 192, 60, 192, 108, 0, 108], W(0.08))
  line(ctx, 0, 62, 192, 60, W(0.12), 1)
  glow(ctx, 40 + r() * 20, 10, 70, 0.09)
  // person: torso + crossed legs, behind the objects
  ctx.fillStyle = 'rgba(10,10,12,0.28)'
  ctx.beginPath()
  ctx.ellipse(96, 8, 12, 13, 0, 0, 7)
  ctx.fill()
  ctx.beginPath()
  ctx.roundRect(72, 18, 48, 50, 14)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(96, 72, 54, 10, 0, 0, 7)
  ctx.fill()
}

function hands(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = 'rgba(222,192,170,0.22)'
  ctx.beginPath()
  ctx.ellipse(x - 26, y + 6, 12, 5, -0.5, 0, 7)
  ctx.ellipse(x + 26, y + 4, 12, 5, 0.5, 0, 7)
  ctx.fill()
}

function grade(ctx: Ctx, w: number, h: number, temp: number, rand: R, warm: boolean) {
  // vignette
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, w * 0.65)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, `rgba(0,0,0,${warm ? 0.45 : 0.6})`)
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
  // grain
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const amt = 12 + rand() * 6
  const gain = warm ? 2.1 : 1.85 + rand() * 0.35
  const cool = temp < 0 ? -temp : 0
  const hot = temp > 0 ? temp : 0
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amt
    const l = (d[i] + d[i + 1] + d[i + 2]) / 765
    d[i] = d[i] * gain + n + hot * 10 * l - cool * 4
    d[i + 1] = d[i + 1] * gain + n + hot * 4 * l + cool * 3
    d[i + 2] = d[i + 2] * gain + n - hot * 8 * l + cool * 9
  }
  ctx.putImageData(img, 0, 0)
}
