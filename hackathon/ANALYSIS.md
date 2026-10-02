# Analysis (framework applied)

Applies [framework/PLAYBOOK.md](../framework/PLAYBOOK.md) to this event. Written ~11:30 on 2 Oct.
Ideas below are proposals; Touko and Alex pick.

## 1. Classification

| Axis | Call | Why |
|---|---|---|
| Scoring mode | **Technical-first, with a product-first demo** | All six judges are sponsor engineers or product people (NVIDIA ×2, VAST ×2, CoreWeave, SpaceXAI). No investors. Business validation earns close to nothing. |
| Challenge style | **Sponsor-needs** | VAST's line: video "stays in storage, unwatched and underused". They want proof the VAST AI OS + Cosmos stack turns an archive into something that **acts**. |
| Judging mode | Table walkthrough with each team, then demos | The walkthrough rewards a working thing judges can poke at. The stage demo rewards one clean "wow" moment. |
| Submission | `SUBMISSION.md` via the `submission` skill + **code link** (required) + optional live app link | Destination still TBD. An incomplete entry may not be judged. |
| Tracks | One overall ranking (DGX Spark for 1st) | No side tracks visible, so build one product. |

Time split for technical-first: about ⅓ understanding the constraint (mostly done in this repo), ⅔ building the easiest impressive thing and demoing it cleanly.

## 2. What each judge wants

- **NVIDIA (Multimodal TME; Product):** Cosmos Reason used for *reasoning*, not just captions. Physical-AI flavor. The **Canary-1B** endpoint is deployed but not wired in, and the guide says "let your imagination go and hook it in". Few teams will use it.
- **VAST (DevRel; AI Data Platform director):** VastDB + DataEngine as the engine. Their own key insight: **"the prompt decides what gets indexed."** Re-ingest with a custom prompt is the loop they want to see used. Querying VastDB directly (`vastdb-read`) shows depth.
- **CoreWeave (Physical AI lead):** GPU inference used heavily, physical-world use cases (warehouse, driving, robots), W&B serverless inference for app logic.
- **SpaceXAI (field engineer):** built with Cursor agent + skills, fast.

Mirror their words in the pitch: *unwatched archive → searchable → reasons → acts*, *production-ready*, *VAST AI OS*, *Cosmos Reason*.

## 3. Where the field will crowd

- **Search UI / "ask your archive" chat.** VSS already ships Search, Explore, Dashboard and `/agent/ask` (grounded Q&A). A thin wrapper on these is the baseline every team gets for free. **Don't build this alone.**
- **"Person close to a moving vehicle" board.** It's the anchor example in ARCHITECTURE_REFERENCE, so many teams will copy it.
- **Warehouse near-miss dashboard.** Example prompt #3 in the reference. Also crowded.

## 4. Edges for us

1. **Self-improving loops won before.** CoreWeave Weave challenge (12–13.9) and YC 3rd place (27.9) were both "gets better with every X". Here the natural loop is **closing the index gap**: a question fails → the agent works out what Cosmos never wrote down → rewrites the ingestion prompt → re-ingests → answers with clip evidence. That is exactly VAST's "prompt decides what gets indexed" lesson, automated.
2. **Canary-1B** (voice in or out) is cheap wow and directly answers NVIDIA's invitation.
3. **Weave tracing** of the agent on W&B, which Touko has shipped before. CoreWeave owns W&B.
4. Helios manufacturing context makes a shop-floor or warehouse safety story credible from a real user's mouth.

## 5. Idea shortlist

Score: one-sentence clarity / challenge fit / demoability / buildable by 17:30 / beats the crowd (1–5).

| # | Idea | One sentence | Score |
|---|---|---|---|
| **A** | **Self-teaching video index** (recommended) | "Ask your cameras anything; if the archive never wrote it down, the agent teaches Cosmos what to look for, re-indexes, and answers with the clip." | 4/5/4/3/5 |
| B | Safety officer agent (warehouse + streets) | "An agent that patrols the archive, finds near-misses, and files an incident report with the clip, bbox crop and severity." | 5/5/5/4/2 |
| C | Fleet dashcam scorecard | "Per-drive safety report from PIE dashcam drives: every risky moment, timestamped, with a coaching summary." | 5/4/4/4/3 |
| D | Voice radio for cameras (Canary) | "Talk to your camera network like a dispatcher; it answers out loud with the clip." | 5/3/5/4/3 |

**Recommendation: A as the engine, B's action as the payoff, D's voice as the garnish if time allows.**
Demo arc (2 min):
1. Spoken or typed question on warehouse footage, e.g. *"was anyone without a hi-vis vest near a forklift?"*
2. Plain search fails or returns weak hits. Show why: the captions never mention vests.
3. The agent proposes a new ingestion prompt, re-ingests the relevant clips, and the before/after captions appear.
4. Same question → hits with clips and bbox crops → the agent files an incident card (the "act").
5. A Weave trace shows each step. Close with: "Every question makes the archive smarter."

Backup if re-ingest proves slow or flaky in the first hour: **B** on the existing captions, with A's loop shown on 1–2 clips that were pre-run.

## 6. Constraints and risks

- **Re-ingest takes minutes per video.** Pre-run the demo clips and show a live run on one short chunk only. Only 1–2 people per team should re-ingest at volume.
- **Shared team pipeline and max 2 VMs.** Touko and Alex each get a VM; all code lives on the VMs. Push to **this repo** from the VM early (GitHub auth on the VM is needed).
- **SF street cams were "ingesting soon"**, so don't depend on them. Warehouse (`sdg_warehouse_cam-2`, ~178 clips) and I-24 are the high-signal packs.
- **No internet video.** Use the provided corpus only.
- **App LLM calls should go through W&B inference** (`WANDB_*` env), not our usual Gemini/Claude. Our default React/Convex stack doesn't fit. Use a small web app deployed with `deployment/deploy-app-no-registry` to `/app` on the team host so judges can click it.
- **Code link must be openable by judges.** This repo is private. Make it public (and drop the passcode from ONSITE.md) before submitting, after Touko's OK.

## 7. Timeline (demos ~17:30, confirm in the room)

| Time | Do |
|---|---|
| now–12:00 | Team form, VMs, test drive loop (search → ask → find the gap). Check what the warehouse captions actually say. |
| 12:00 | Lock idea + backup. Kick off pre-ingest of the demo clips with the new prompt. |
| 12:00–14:30 | Core loop end to end, ugly: question → gap detection → prompt rewrite → re-ingest → answer. |
| 14:30–16:00 | UI on `/app`, incident card, before/after caption view, Weave traces. Voice if ahead. |
| 16:00 | **Feature freeze.** Seed the demo path, record a backup video, run the `submission` skill. |
| 16:30–17:15 | Rehearse the 2-minute demo 3×, prep table walkthrough answers. |

Roles: one presenter decided now. Split ingest/agent loop vs. app/UI between the two VMs.

## 8. Before submitting

- [ ] Happy path runs from a clean start
- [ ] Code pushed here, repo openable by judges
- [ ] `/app` live link works from a phone
- [ ] Backup video recorded
- [ ] Pitch names Cosmos Reason, Cosmos Embed, YOLO, VastDB/DataEngine, CoreWeave GPUs, W&B, Cursor
- [ ] Postmortem afterwards: [framework/POSTMORTEM_TEMPLATE.md](../framework/POSTMORTEM_TEMPLATE.md)
