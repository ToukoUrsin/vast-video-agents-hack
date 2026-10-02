# Understudy server

FastAPI proxy that holds the team credentials and talks to VSS / VastDB, Cosmos Reason,
Cosmos Embed and W&B Inference. The web app (Vite, port 5180) proxies `/api` here.

## Run

```bash
cd server
uv sync
ssh -f -N -D 1080 vastvm          # SOCKS tunnel for the private VSS backend (only /api/health + uploads need it)
uv run uvicorn app:app --port 8787 --reload
uv run smoke_test.py              # hits every endpoint with real frames, prints latencies
```

## Env

Read from `../.env.local` (gitignored, never commit): `VSS_USERNAME`, `VSS_PASSWORD`, `INGRESS_URL`,
`GPU_BEARER_TOKEN`, `WANDB_API_KEY`, plus `S3_ENDPOINT`, `ACCESS_KEY`, `SECRET_KEY`, `VASTDB_BUCKET`,
`VDB_*` for the VastDB export. Optional: `UNDERSTUDY_LLM` (default `meta-llama/Llama-3.3-70B-Instruct`),
`UNDERSTUDY_WEAVE=0` to turn off Weave tracing (project `vastdata/team-39`), `VSS_SOCKS_PROXY`.

## Endpoints

| Route | Body | Returns |
|---|---|---|
| `GET /api/health` | | reachability + ms for `vss`, `cosmos_reason`, `cosmos_embed`, `wandb`, `task_index` |
| `POST /api/check-step` | JSON `{frames: [jpeg b64 or data URL], step, task, prev_step?, next_step?}` or multipart (`frames` files + fields) | `{done, issue, latency_ms, latencyMs}`. Cosmos Reason, temp 0, last 4 frames at 480 px |
| `POST /api/identify` | `{frames, tasks?: [str or {id,label,prompt}], method?: "embed"\|"reason"}` | `{task, task_id, confidence, method, scores, latency_ms}` |
| `POST /api/expert-clip` | `{task, step_index}` (task = id or label) | `{url, start_s, end_s, step}` or `{url: null, reason}` |
| `POST /api/feedback` | `{task, steps: [{text, done, issue, t}]}` | `{score, feedback: [str, str]}` via W&B LLM |
| `GET /api/library` | | the archive snapshot JSON |
| `POST /api/search` | `{query, top_k?: 8}` | VSS semantic search (`/api/v1/search`, Cosmos Embed + VastDB) via the SOCKS tunnel: `{results: [{caption, location, camera_id, similarity, start_s, end_s, task, take, clip_id, thumb}], embedding_ms, search_ms}`; 503 + `fix` when the tunnel is down |
| `GET /api/search/thumb` | `?source=&t=` | JPEG frame for a hit (local take mp4, else the VSS stream), cached in the temp dir |

Identify: frames are stitched into an 8-frame MP4 and embedded with Cosmos Embed (it needs >= 8
frames). With our recordings indexed it picks the nearest task cluster centroid; before that it
compares against text embeddings of the task descriptions (zero-shot) and falls back to asking
Cosmos Reason to pick when the margin is small.

## Coach voice

`hsec exec --only ELEVENLABS_API_KEY -- uv run render_voice.py` pre-renders every fixed coach line
(ElevenLabs, voice Sarah) into `web/public/voice/` + `manifest.json`; rerun after changing task
steps or correction strings. Lines not in the manifest fall back to the browser voice.

## Data pipeline

- `build_map.py` builds `web/src/data/real-archive.json`, `web/public/clips/*.jpg|mp4` and
  `server/task_index.json`. `--refresh` re-exports from VastDB + S3 by running `vm_export.py`
  on the team VM over `ssh vastvm` (that's where VastDB/S3 are reachable). Layout: UMAP of the Cosmos
  Embed caption vectors. Clusters: k-means (`--k 8`). Names and steps: W&B LLM.
- `upload_recording.py` uploads our task takes to VSS (`POST /api/v1/videos/upload`) with a custom
  step-by-step Cosmos prompt and tags `understudy, task:<id>, take:<n>, label:<label>, score:<n>`.
  When ingest finishes: `uv run build_map.py --refresh`. Takes become `source: "ours"` clips,
  steps are learned from the best take, and expert clips come from the transcoded take MP4s.

```bash
uv run upload_recording.py ~/takes/lego1.mp4 --task lego-tower --label "Lego assembly" --take 1 --score 95
uv run build_map.py --refresh
```
