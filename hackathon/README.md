# Real-Time Video Agents Hack – SF (VAST Builders Challenge)

Team: Touko Ursin + Marc "Alex" Smeds (@TurpoFIN).

This repo is the official starter, [vast-data/vast-builders-challenge](https://github.com/vast-data/vast-builders-challenge),
with its history kept (remote `upstream`). Pull organizer updates with `git pull upstream main`.
Our own notes live in `hackathon/`. Root-level `.md` files other than the upstream ones are
gitignored, so don't put new notes in the repo root.

## Event

- **Date:** Fri 2 Oct 2026, 9:00 AM – 7:00 PM PDT (Luma), agenda runs to 7:30 PM
- **Venue:** AWS Builder Loft, Financial District, San Francisco
- **Event page:** https://luma.com/vastsf
- **Organizer:** [tokens&](https://x.com/tokensandai) (Alessandro Amenta, Syerra Laurusaitis, Jacopo Piazza, Marlene Ronstedt) with AWS Builder Loft
- **Hosted with:** VAST Data, with NVIDIA, SpaceXAI (Cursor), CoreWeave and Weights & Biases
- **Series:** SF is the first of three. NYC 9 Oct ([luma.com/vastnyc](https://luma.com/vastnyc)), London 17 Oct ([luma.com/vastlondon](https://luma.com/vastlondon))

## Agenda

| Time | |
|---|---|
| 9:30 | Doors open + breakfast |
| 10:00 | Opening keynotes |
| 10:30 | Build begins |
| 13:30 | Lunch |
| 17:30 | Demos |
| 19:30 | Closing & awards |

An earlier version of the event listing said demos 16:30 and awards 19:00. Trust what organizers say in the room.

## Task

Build a **video agent**: an app that understands video and does something useful with it.
Search hours of footage in plain language, ask what happened, spot events, or trigger an
action when something matters. **One idea, working, shipped by end of day.** Be specific:
"flag someone missing a hard hat" beats "watch for safety issues".

## Prizes

- 1st place: NVIDIA DGX Spark
- HuggingFace Microduck
- Cursor credits
- Cash gift cards

## Judges

- Hassan Moustafa – TME, Multimodal AI @ NVIDIA
- Adam Ryason, Ph.D. – Product @ NVIDIA
- Ram B. – Sr. Developer Advocate @ VAST Data
- Brian Verkley – Director, AI Data Platform @ VAST Data
- Anushrav V. – Solutions Architect, Physical AI Lead @ CoreWeave
- Arnav Verma – Field Engineer @ SpaceXAI

NVIDIA, VAST, CoreWeave and SpaceXAI each have judges, so use their parts visibly (Cosmos, VAST DB/S3, CoreWeave GPUs, W&B inference, Cursor).

## Stack (pre-built, already running per team)

- **VAST AI OS:** S3 for video, DataEngine runs the ingest pipeline, VastDB holds vectors + metadata
- **NVIDIA Cosmos Reason** writes a description of every video segment, following an ingestion prompt
- **NVIDIA Cosmos Embed** makes the vectors for semantic search
- **YOLO** does object detection and tracking
- **Canary 1B** (speech/transcription endpoint, see `config.example`)
- **CoreWeave GPUs** serve the models
- **Weights & Biases serverless inference** for our app's own LLM logic (`WANDB_*` env vars on the VM)
- **Cursor** (the "SpaceXAI" sponsor) is the build tool; skills live in `.cursor/skills/`

Key rule: **the ingestion prompt decides what gets indexed.** If Cosmos wasn't asked about
something, it can't be searched. Re-ingest with a new prompt (`reingest-videos`,
`reingest-chunk`) to fix that. It takes a few minutes; only 1–2 people per team should
re-ingest at volume.

## Video corpus

- Dashcam driving footage: vehicles and pedestrians at intersections and crossings
- Overhead multi-camera highway footage tracking vehicles along an interstate
- A private neighborhood camera capturing car movement

Full folder/camera list and example queries: [ARCHITECTURE_REFERENCE.md](../ARCHITECTURE_REFERENCE.md#video-corpus-already-indexed).
**Don't ingest internet video (e.g. YouTube);** only the provided footage is licensed.

## Access on the day

1. Join [Cosmos community](https://community.vastdata.com/t/about-the-workshop-category/1969) → workshop page → **Open Desktop** (VM passcode shared in the room).
2. Max **2 VMs per team**. Pick the assigned team number (`team-N`) once; all members share one pipeline, index and credentials.
3. Team numbers are assigned via [tokens& Discord](https://discord.com/invite/VyhUqgn6pc).
4. On the VM: `cd ~/vast-builders-challenge && agent` (Cursor CLI), `/model` → Auto.
5. **Video Search & Summary UI** link on the same workshop page: Search / Explore / Dashboard tabs.
6. Cursor credits: sign in with the email you applied with; top-ups via [this form](https://forms.gle/AVta9RRTmfdeUNX26). Touko got a SpaceXAI/Cursor referral code by email (2 Oct, Sarah Goomar), kept out of this repo.
7. Help: run the health check (`run a git pull`, then `check that everything is working`), then `/ask-cosmos` and post on Cosmos.

VM keybindings: copy/paste `Ctrl+Shift+C` / `Ctrl+Shift+V`; zoom `Ctrl -` / `Ctrl 0`.

## Submission

- Run the `submission` skill in Cursor ("help me submit our project"). It writes `SUBMISSION.md`: team number, 2–3 sentence description (<40 words), stack, **code link**, live app link, supplementary links, feedback.
- No personal details in the submission.
- Checklist: runs from a clean start, code pushed somewhere judges can open, one person can explain it in 2 minutes.
- Where to submit wasn't decided in the starter repo. Wait for organizer instructions.
- Judging: first round is a walkthrough with each team, then demos.

## Guides in this repo

- [BEFORE_YOU_BUILD.md](../BEFORE_YOU_BUILD.md): prep
- [BUILD_DAY.md](../BUILD_DAY.md): the guide for the day
- [ARCHITECTURE_REFERENCE.md](../ARCHITECTURE_REFERENCE.md): corpus, metadata, example queries, demo packs
- [config.example](../config.example): every env var the skills read
- Example of a project on this stack: [karanjit-nexovia/harvest](https://github.com/karanjit-nexovia/harvest)

## On-site instructions

See [ONSITE.md](ONSITE.md) (VM passcode, team form). Photos in [photos/](photos/).

## Strategy

[ANALYSIS.md](ANALYSIS.md) applies our hackathon framework ([../framework/](../framework/)) to this event.
