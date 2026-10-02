// One persistent canvas that draws every clip thumbnail as a sprite. Library, Map and the
// transitions between them all move the same sprites, so tiles can fly from the ingest grid
// into clusters at 60 fps.
import type { Clip } from '../data/types'
import { getThumb, onThumbsChange } from './thumbs'

export const STAGE_W = 1920
export const STAGE_H = 1080

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Camera {
  /** screen = point * s + (x, y) */
  x: number
  y: number
  s: number
}
export interface TileTarget extends Rect {
  alpha: number
  delay?: number
  dur?: number
  /** perpendicular arc offset in px at mid-flight */
  arc?: number
}
interface TileState {
  clip: Clip
  from: Rect & { alpha: number }
  to: TileTarget
  t0: number
  dur: number
}

const ease = (p: number) => {
  if (p >= 1) return 1
  const w = 7.2
  return 1 - (1 + w * p) * Math.exp(-w * p)
}

export class FieldEngine {
  canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private tiles = new Map<string, TileState>()
  private slots: Rect[] = []
  private slotAlpha = 0
  private raf = 0
  private dirty = true
  private k = 1
  hovered: string | null = null
  focusCluster: string | null = null
  /** search hits: everything else dims, hits get a green outline */
  highlight: Set<string> | null = null
  dimSource: 'stock' | 'ours' | null = null
  interactive = false
  onHover: ((clip: Clip | null, rect: Rect | null) => void) | null = null
  onClick: ((clip: Clip | null, pt: { x: number; y: number }) => void) | null = null
  /** Called every drawn frame with the current camera, so DOM overlays can follow */
  onCamera: ((cam: Camera) => void) | null = null
  private cam = { from: { x: 0, y: 0, s: 1 }, to: { x: 0, y: 0, s: 1 }, t0: 0, dur: 1 }

  constructor(clips: Clip[]) {
    for (const clip of clips) {
      const r = { x: STAGE_W / 2, y: STAGE_H / 2, w: 0, h: 0, alpha: 0 }
      this.tiles.set(clip.clip_id, { clip, from: r, to: r, t0: 0, dur: 1 })
    }
    onThumbsChange(() => (this.dirty = true))
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.resize()
    canvas.addEventListener('mousemove', this.handleMove)
    canvas.addEventListener('mouseleave', this.handleLeave)
    canvas.addEventListener('click', this.handleClick)
    window.addEventListener('resize', this.resize)
    const loop = () => {
      this.draw()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  detach() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resize)
    this.canvas?.removeEventListener('mousemove', this.handleMove)
    this.canvas?.removeEventListener('mouseleave', this.handleLeave)
    this.canvas?.removeEventListener('click', this.handleClick)
  }

  resize = () => {
    if (!this.canvas) return
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H)
    this.k = scale * (window.devicePixelRatio || 1)
    this.canvas.width = Math.round(STAGE_W * this.k)
    this.canvas.height = Math.round(STAGE_H * this.k)
    this.dirty = true
  }

  private sample(t: TileState, now: number) {
    const p = Math.max(0, Math.min(1, (now - t.t0) / t.dur))
    const e = ease(p)
    const { from, to } = t
    let x = from.x + (to.x - from.x) * e
    let y = from.y + (to.y - from.y) * e
    if (to.arc && p > 0 && p < 1) {
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.hypot(dx, dy) || 1
      const s = Math.sin(Math.PI * e) * to.arc
      x += (-dy / len) * s
      y += (dx / len) * s
    }
    return {
      x,
      y,
      w: from.w + (to.w - from.w) * e,
      h: from.h + (to.h - from.h) * e,
      alpha: from.alpha + (to.alpha - from.alpha) * e,
      moving: p < 1,
    }
  }

  /** Animate tiles to new targets. Tiles not listed keep their target. */
  setTargets(targets: Map<string, TileTarget>) {
    const now = performance.now()
    for (const [id, to] of targets) {
      const t = this.tiles.get(id)
      if (!t) continue
      const cur = this.sample(t, now)
      t.from = { x: cur.x, y: cur.y, w: cur.w, h: cur.h, alpha: cur.alpha }
      t.to = to
      t.t0 = now + (to.delay ?? 0)
      t.dur = to.dur ?? 700
    }
    this.dirty = true
  }

  /** Jump tiles to a state without animating. */
  place(targets: Map<string, Rect & { alpha: number }>) {
    for (const [id, r] of targets) {
      const t = this.tiles.get(id)
      if (!t) continue
      t.from = { ...r }
      t.to = { ...r }
      t.t0 = 0
      t.dur = 1
    }
    this.dirty = true
  }

  hideAll(dur = 400) {
    const m = new Map<string, TileTarget>()
    const now = performance.now()
    for (const [id, t] of this.tiles) {
      const c = this.sample(t, now)
      m.set(id, { x: c.x, y: c.y, w: c.w, h: c.h, alpha: 0, dur })
    }
    this.setTargets(m)
  }

  camera(now = performance.now()): Camera {
    const c = this.cam
    const e = ease(Math.max(0, Math.min(1, (now - c.t0) / c.dur)))
    return {
      x: c.from.x + (c.to.x - c.from.x) * e,
      y: c.from.y + (c.to.y - c.from.y) * e,
      s: c.from.s + (c.to.s - c.from.s) * e,
    }
  }

  setCamera(to: Camera, dur = 900) {
    const now = performance.now()
    this.cam = { from: this.camera(now), to, t0: now, dur }
    this.dirty = true
  }

  setSlots(slots: Rect[], alpha: number) {
    this.slots = slots
    this.slotAlpha = alpha
    this.dirty = true
  }

  setHighlight(ids: Iterable<string> | null) {
    this.highlight = ids ? new Set(ids) : null
    this.dirty = true
  }

  setFocus(cluster: string | null) {
    this.focusCluster = cluster
    this.dirty = true
  }

  private toStage(e: MouseEvent) {
    const r = this.canvas!.getBoundingClientRect()
    const c = this.camera()
    const sx = ((e.clientX - r.left) * STAGE_W) / r.width
    const sy = ((e.clientY - r.top) * STAGE_H) / r.height
    return { x: (sx - c.x) / c.s, y: (sy - c.y) / c.s }
  }

  hitTest(x: number, y: number): { clip: Clip; rect: Rect } | null {
    const now = performance.now()
    let best: { clip: Clip; rect: Rect } | null = null
    for (const t of this.tiles.values()) {
      const s = this.sample(t, now)
      if (s.alpha < 0.05) continue
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) best = { clip: t.clip, rect: s }
    }
    return best
  }

  private handleMove = (e: MouseEvent) => {
    if (!this.interactive) return
    const p = this.toStage(e)
    const hit = this.hitTest(p.x, p.y)
    const id = hit?.clip.clip_id ?? null
    if (id !== this.hovered) {
      this.hovered = id
      this.dirty = true
      this.onHover?.(hit?.clip ?? null, hit?.rect ?? null)
    }
    this.canvas!.style.cursor = hit ? 'pointer' : 'default'
  }
  private handleLeave = () => {
    if (this.hovered) {
      this.hovered = null
      this.dirty = true
      this.onHover?.(null, null)
    }
  }
  private handleClick = (e: MouseEvent) => {
    if (!this.interactive) return
    const p = this.toStage(e)
    this.onClick?.(this.hitTest(p.x, p.y)?.clip ?? null, p)
  }

  private draw() {
    const ctx = this.ctx
    if (!ctx) return
    const now = performance.now()
    let moving = false
    for (const t of this.tiles.values()) if (now < t.t0 + t.dur) moving = true
    if (now < this.cam.t0 + this.cam.dur) moving = true
    if (!moving && !this.dirty) return
    this.dirty = false
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0)
    ctx.clearRect(0, 0, STAGE_W, STAGE_H)
    const cam = this.camera(now)
    this.onCamera?.(cam)
    ctx.setTransform(this.k * cam.s, 0, 0, this.k * cam.s, this.k * cam.x, this.k * cam.y)

    if (this.slotAlpha > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.05 * this.slotAlpha})`
      ctx.lineWidth = 1
      for (const s of this.slots) ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1)
    }

    let hoverRect: { x: number; y: number; w: number; h: number } | null = null
    const hits: Rect[] = []
    for (const t of this.tiles.values()) {
      const s = this.sample(t, now)
      let a = s.alpha
      if (this.focusCluster && t.clip.cluster_id !== this.focusCluster) a *= 0.16
      if (this.highlight) {
        if (this.highlight.has(t.clip.clip_id)) {
          if (a > 0.05) hits.push(s)
        } else a *= 0.14
      }
      if (a < 0.01 || s.w < 1) continue
      ctx.globalAlpha = a
      const img = getThumb(t.clip, s.w > 110 ? 'lg' : 'sm')
      const r = s.w > 70 ? 6 : s.w > 30 ? 2 : 1
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(s.x, s.y, s.w, s.h, r)
      ctx.clip()
      ctx.drawImage(img, s.x, s.y, s.w, s.h)
      ctx.restore()
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, r)
      ctx.stroke()
      if (t.clip.clip_id === this.hovered) hoverRect = s
    }
    ctx.globalAlpha = 1
    if (hits.length) {
      ctx.strokeStyle = '#4BE38A'
      ctx.lineWidth = 2.5 / cam.s
      for (const h of hits) {
        ctx.beginPath()
        ctx.roundRect(h.x - 2, h.y - 2, h.w + 4, h.h + 4, 4)
        ctx.stroke()
      }
    }
    if (hoverRect) {
      ctx.strokeStyle = 'rgba(244,242,238,0.95)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(hoverRect.x - 1, hoverRect.y - 1, hoverRect.w + 2, hoverRect.h + 2, 3)
      ctx.stroke()
    }
  }
}
