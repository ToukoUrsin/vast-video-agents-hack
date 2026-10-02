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
  const canvas = renderScene(sceneFor(clip), dim.w, dim.h, hashString(clip.clip_id) + variant * 7919)
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
    if (clip.cluster_id === 'making-tea') return 'task-tea'
    if (clip.cluster_id === 'safety-gear') return 'task-gear'
    return 'task-box'
  }
  return getSiteKind(clip.location)
}

export function renderScene(kind: SceneKind, w: number, h: number, seed: number): HTMLCanvasElement {
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
  SCENES[kind](ctx, rand)
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

const SCENES: Record<SceneKind, (ctx: Ctx, r: R) => void> = {
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
  'task-box'(ctx, r) {
    poly(ctx, [0, 60, 192, 54, 192, 108, 0, 108], W(0.05))
    line(ctx, 0, 60, 192, 54, W(0.12), 1)
    glow(ctx, 150, 10, 60, 0.08)
    const bx = 64 + r() * 20
    const by = 52 + r() * 6
    // box
    poly(ctx, [bx, by, bx + 52, by - 4, bx + 54, by + 30, bx + 2, by + 34], 'rgba(190,160,120,0.28)')
    poly(ctx, [bx, by, bx + 52, by - 4, bx + 40, by - 18, bx - 10, by - 12], 'rgba(210,180,140,0.2)')
    line(ctx, bx + 26, by - 2, bx + 27, by + 32, 'rgba(240,230,210,0.22)', 2)
    // tape roll
    ctx.strokeStyle = W(0.2)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(bx + 80, by + 18, 7, 0, 7)
    ctx.stroke()
    // hands / forearms
    ctx.fillStyle = 'rgba(220,190,170,0.22)'
    ctx.beginPath()
    ctx.ellipse(bx - 8, by + 6, 12, 5, -0.4, 0, 7)
    ctx.ellipse(bx + 62, by - 2, 12, 5, 0.5, 0, 7)
    ctx.fill()
    ctx.fillStyle = W(0.08)
    ctx.beginPath()
    ctx.roundRect(bx - 4, 0, 62, 30, 12)
    ctx.fill()
  },
  'task-tea'(ctx, r) {
    poly(ctx, [0, 66, 192, 62, 192, 108, 0, 108], W(0.05))
    line(ctx, 0, 66, 192, 62, W(0.12), 1)
    ctx.fillStyle = W(0.05)
    ctx.fillRect(120, 4, 54, 40)
    glow(ctx, 147, 24, 40, 0.12)
    const kx = 46 + r() * 16
    ctx.fillStyle = W(0.16)
    ctx.beginPath()
    ctx.moveTo(kx, 64)
    ctx.lineTo(kx + 4, 36)
    ctx.quadraticCurveTo(kx + 16, 30, kx + 28, 36)
    ctx.lineTo(kx + 32, 64)
    ctx.fill()
    ctx.fillRect(kx + 30, 44, 8, 3)
    ctx.fillStyle = W(0.2)
    ctx.beginPath()
    ctx.roundRect(kx + 56, 50, 16, 16, 3)
    ctx.fill()
    ctx.strokeStyle = W(0.2)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(kx + 74, 58, 4, -1.4, 1.4)
    ctx.stroke()
    ctx.fillStyle = 'rgba(220,190,170,0.2)'
    ctx.beginPath()
    ctx.ellipse(kx + 20, 30, 12, 5, 0.3, 0, 7)
    ctx.fill()
  },
  'task-gear'(ctx, r) {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = W(0.035 + (i % 2) * 0.015)
      ctx.fillRect(i * 32, 0, 30, 76)
      ctx.fillStyle = W(0.08)
      ctx.fillRect(i * 32 + 24, 30, 2, 8)
    }
    ctx.fillStyle = K(0.3)
    ctx.fillRect(0, 76, 192, 32)
    const px = 80 + r() * 30
    ctx.fillStyle = W(0.12)
    ctx.beginPath()
    ctx.arc(px, 22, 9, 0, 7)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(px - 18, 33, 36, 50, 8)
    ctx.fill()
    // vest
    poly(ctx, [px - 16, 36, px - 3, 36, px - 4, 80, px - 16, 80], 'rgba(230,200,120,0.3)')
    poly(ctx, [px + 3, 36, px + 16, 36, px + 16, 80, px + 4, 80], 'rgba(230,200,120,0.3)')
    line(ctx, px - 16, 62, px - 4, 62, W(0.35), 2)
    line(ctx, px + 4, 62, px + 16, 62, W(0.35), 2)
    if (r() < 0.6) {
      ctx.fillStyle = W(0.22)
      ctx.beginPath()
      ctx.ellipse(px, 15, 11, 6, 0, Math.PI, 0)
      ctx.fill()
    }
  },
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
