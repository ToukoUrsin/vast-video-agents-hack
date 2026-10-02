# Understudy

**Every recording becomes a coach.** Understudy turns video nobody watches into a live coach: it learns a
task from expert recordings in the VAST archive, then watches a new person on camera, corrects mistakes out
loud with the expert clip for that step, and scores the attempt.

Built at the Real-Time Video Agents Hack SF (VAST Builders Challenge), 2 Oct 2026, team 39.

- **Demo video:** https://drive.google.com/file/d/1FTKoPFUKaKgEr-alHf8hGr9LpdgJuH9I/view (also on Loom: https://www.loom.com/share/af2170bbaa094561b5fd8c4181b862f4)
- **Live app:** https://hints-modules-jvc-suspension.trycloudflare.com (allow the camera on the Coach screen)

## How it works

| Stage | What happens | Stack |
|---|---|---|
| Library | 2,352 archive clips from 6 camera sites, plus our 9 recorded takes, which we segmented, captioned, embedded and inserted into the team VastDB ourselves (2,409 rows) | VAST AI OS (S3, DataEngine, VastDB), YOLO11, Cosmos Reason, Cosmos Embed |
| Map | Clips laid out by Cosmos Embed similarity (UMAP), clustered and named without labels | Cosmos Embed, Llama 3.3 70B on W&B |
| Ask the archive | Natural-language search over the whole archive, including our takes | VAST semantic search |
| Coach | Recognises the task from the camera, then about once a second Cosmos Reason reads a structured scene report from two frames in parallel; only fields both frames agree on are kept; per-step checks track progress (with catch-up), and corrections are spoken with the expert clip | Cosmos Reason + Embed on CoreWeave GPUs, ElevenLabs voice |
| Score | Step timeline, corrections, you-vs-expert frames, feedback | Llama 3.3 70B on W&B, Weave traces |

Tasks in the demo: **Cap swap** (main live task), Cup pyramid, VAST astronaut minifigure.

## Run it

```sh
cp config.example .env.local   # fill in team credentials (see hackathon/ACCESS.md for the fields we use)
./demo.sh                      # API on :8787, web on :5190
```

Keys: `1`–`4` screens · `Space` next beat · `R` reset coach · `T` force Cap swap · `/` search · `D` trace drawer.

## Repo map

- `web/`: React + Vite + Tailwind + Framer Motion app (Library, Map, Coach, Score)
- `server/`: FastAPI: live step checks, task recognition, feedback, search proxy, our VastDB ingest (`ingest_takes.py`, `vm_ingest.py`), map builder
- `hackathon/`: plan, design spec, demo script, access notes, submission
- Built on the organizers' starter kit: [vast-data/vast-builders-challenge](https://github.com/vast-data/vast-builders-challenge) ([BUILD_DAY.md](BUILD_DAY.md), [ARCHITECTURE_REFERENCE.md](ARCHITECTURE_REFERENCE.md))
