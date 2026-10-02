# Understudy: design spec

The judges see this on a projector from across a room, for under three minutes. If it looks
generic, the tech won't matter. Every screen must look like a finished product launch, not a
hackathon dashboard.

## Direction

- **Broadcast control room, made calm.** Think Apple keynote product shots, Linear's site, sports
  broadcast overlays for the coach screen. Real video frames are the hero; UI chrome recedes.
- **Dark stage.** Background `#0A0A0B`, surfaces `#121214`, hairlines `rgba(255,255,255,0.08)`.
  Text warm white `#F4F2EE`, secondary `#8C8A86`.
- **One accent, used sparingly.** Signal green `#4BE38A` for "correct / live / done". Error
  `#FF5A4E` only for mistakes. Amber `#FFB547` only for "in progress". No other colors except
  cluster tints (muted, desaturated, max 8).
- **Type.** Geist Sans for UI, Geist Mono for counts, timestamps and pipeline stages. Big
  numerals (score 160–220 px). Minimum 20 px for anything the audience must read; step text on
  the coach screen 32–40 px.
- **Grid.** 1920×1080 first. Generous margins (64–96 px). Align everything to an 8 px grid.

## Motion

- Purposeful and physical: spring easing, 250–700 ms. Nothing bounces for fun.
- **Showpiece: grid → clusters.** 400+ thumbnail sprites fly from the ingest grid to their
  cluster positions at 60 fps (canvas/WebGL, not 400 DOM nodes). Staggered by cluster, labels
  fade in after their cluster settles. This is the "wow" of the first half; it gets the most
  polish time.
- Pipeline strip: stages light up in sequence, mono counters tick up (real numbers).
- Coach: step tick = short green sweep + soft chime. Mistake = red edge glow on the video frame,
  correction card slides in with the expert clip already playing.
- Score: number counts up once, ticks land one by one.

## Screens

1. **Library.** Left: two source cards (Stock archive, Our recordings) with counts. Right: thumbnail
   grid filling in as clips are ingested. Bottom: pipeline strip with five stages and live counts.
   Hover a tile → caption from Cosmos Reason in a quiet tooltip.
2. **Map.** Full-bleed dark canvas, clusters of real thumbnails, small labels with count. Click a
   cluster → right panel with learned steps (numbered, short) and an expert clip per step. Sloppy
   takes visibly at the cluster edge, dimmed, with a score chip.
3. **Coach.** Webcam large (≈ 65% width), mirrored, thin frame. Right rail: detected task name,
   step list (current step large, done steps checked, upcoming dimmed), a small live status
   ("Watching · 2.1 s"). Spoken lines also appear as captions under the video. Correction card
   overlays bottom-right of the video with the expert clip looping.
4. **Score.** Giant score, five step rows with tick/cross and timestamps, one mistake row with
   thumbnail, two lines of feedback, side-by-side frames (you vs expert) for the mistake step.

## Banned (reads as slop)

Purple/blue gradients, glassmorphism, neon glows everywhere, emoji, stock icons on every row,
drop-shadow cards in a grid, default shadcn dashboard look, lorem ipsum, "AI ✨" badges, more
than one font family per role, centered walls of text, tiny 12 px labels on the projector,
spinners where a real progress state could show.

## Presenter controls

Keyboard: `1`–`4` switch screens, `Space` advances the scripted beat (start ingest, play cluster
animation), `R` resets the coach session. Dev-only controls hidden behind `?dev`.

## Quality bar

Screenshot every screen at 1920×1080 after every change and look at it. Ask: would this pass as a
real product launch slide? If not, fix before adding features.
