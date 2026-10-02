# Understudy: plan

**One line:** every recording becomes a coach. Understudy ingests your footage plus the archive,
finds the tasks by itself, learns the steps from the best takes, then watches the next person
live, corrects them out loud and scores them.

Alex performs, Touko narrates. Target length 2:45.

## Demo script

| # | Time | Screen | What happens | Tech |
|---|---|---|---|---|
| 0 | 0:00–0:10 | Title | "Companies sit on thousands of hours of video nobody watches, including how their best people actually do the work. We turn that into a coach." | – |
| 1 | 0:10–0:40 | **Library** | Two sources: Stock archive (6 sites, ~400 clips) + Our recordings (9 takes). Click Ingest: thumbnails stream in, pipeline strip counts up per stage (Segment → Detect/YOLO → Describe/Cosmos Reason → Embed/Cosmos Embed → VastDB). Hover a tile = Cosmos caption. Labelled as a replay of the real run (time shown). Optional: one real upload starts here and lands on the map by the end. | VAST pipeline + VastDB, real counts |
| 2 | 0:40–1:05 | **Map** | Tiles fly from grid into clusters; labels fade in (Packing a box, Making tea, Putting on safety gear, Forklift moving pallet, Truck changing lanes…). Click "Packing a box": learned step list, best expert clip per step. Sloppy takes sit at the cluster edge with a lower score. | Cosmos Embed vectors → 2D layout + clusters; LLM labels + steps |
| 3 | 1:05–2:05 | **Coach** | Webcam. Alex starts a task silently. ~4 s later the task is recognized and spoken. Each correct step: tick + next step spoken. Alex skips a step: red state, spoken correction, expert clip of that step plays. Alex fixes it, finishes. | Cosmos Reason per clip/frames, Embed match to library, browser TTS |
| 4 | 2:05–2:30 | **Score** | 82/100, step ticks, mistake with thumbnail + timestamp, two lines of feedback, side-by-side of your step vs expert step. | W&B LLM, Weave trace |
| 5 | 2:30–2:45 | Close | Stack slide. "Every recording becomes a coach, and every attempt makes the library better." | – |

Evidence rule: anything replayed or pre-recorded is labelled as such on screen. Never call a replay live.

## Architecture

- `web/`: Vite + React + TypeScript + Tailwind + Framer Motion. Runs on the presenter Mac (localhost = webcam works).
  Run: `cd web && bun install && bun run dev` → http://localhost:5180 · keys 1–4 / Space / R · `?dev` rehearsal bar (N step done, M mistake) · data seam `web/src/data/` (+ optional `web/public/data/library.json`).
- `server/`: small proxy holding team credentials (from `.env.local`, gitignored): VSS backend (`INGRESS_URL`), VastDB reads, Cosmos Reason / Embed endpoints, W&B inference.
- Step check: every ~2–3 s send the latest frames/clip to Cosmos Reason: "Has the person completed '<step>'? If not, what is wrong?" → advance / correct.
- Task recognition: embed the first seconds of live video, nearest cluster in the library.
- Voice out: browser `speechSynthesis`. Canary voice in only if time allows.

## Checks first (gate the plan)

1. Cosmos Reason latency on a ~4 s clip / a few frames (target < 3 s).
2. Team endpoints reachable from the Mac (INGRESS_URL, Cosmos URLs, W&B). If not, run the server on the VM / team K8s.
3. Our own upload ingests and returns usable captions.

## Build split

- Claude (Mac): web app, all four screens, design, server proxy.
- Alex (VM, Cursor): team setup, uploads + custom ingestion prompt, pull embeddings/captions out of VastDB.
- Together: record 3 tasks × 2–3 takes (one sloppy take each), right after the checks.

## Cut order if behind

Canary → stock-archive clusters on the map → side-by-side on score card. Never cut: live coaching, spoken correction + expert clip, score.

## Timeline

| Time | |
|---|---|
| 12:20–13:00 | Checks, team form, config to Mac, UI scaffold with placeholders |
| 13:00–13:30 | Record tasks, upload + ingest |
| 13:30–15:30 | Wire real data: map, coach loop, score |
| 15:30–16:15 | Visual polish pass with screenshots, feature freeze 16:15 |
| 16:15–16:45 | Backup video, submission |
| 16:45–17:30 | Rehearse 3× |
