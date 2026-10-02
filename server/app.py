"""Understudy backend. Run:  uv run uvicorn app:app --port 8787 --reload

Endpoints (all JSON; check-step / identify also accept multipart with `frames` files):
  GET  /api/health        upstream reachability + latency
  POST /api/check-step    {frames, step, task}        -> {done, issue, latency_ms}
  POST /api/identify      {frames, tasks?}            -> {task, task_id, confidence, method, latency_ms}
  POST /api/expert-clip   {task, step_index}          -> {url|null, start_s, end_s}
  POST /api/feedback      {task, steps:[{text,done,issue,t}]} -> {score, feedback:[str,str]}
  GET  /api/library       the real-archive snapshot (same JSON the web app imports)
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps

import upstreams as U

HERE = Path(__file__).resolve().parent
TASK_INDEX = HERE / "task_index.json"
SNAPSHOT = U.ROOT / "web" / "src" / "data" / "real-archive.json"

# Tasks the demo performs. Used for zero-shot recognition until our recordings are in the index.
DEFAULT_TASKS = [
    {"id": "cap-swap", "label": "Cap swap", "prompt": "a person with a green Mountain Dew bottle and a Coca-Cola bottle on the floor, taking the caps off and swapping the bottles"},
    {"id": "cup-pyramid", "label": "Cup pyramid", "prompt": "a person stacking clear plastic cups upside down into a pyramid on the floor, then nesting them into one stack"},
    {"id": "vast-astronaut", "label": "VAST astronaut", "prompt": "a person assembling a small white Lego astronaut minifigure on a round white base plate"},
]

# Steps + what Cosmos should look at for each task. Cosmos (vision) reports the scene state,
# the W&B LLM judges the current step against the ordered steps. Two stages because the
# small vision model perceives well but is weak at "was a step skipped" sequence logic.
TASK_DEFS = {
    "cap-swap": {
        "label": "Cap swap",
        "done_when": [
            "the Mountain Dew bottle has no cap on (its green cap is off)",
            "the Coca-Cola bottle has no cap on (its black cap is off)",
            "the bottles have swapped places: the Coca-Cola is now on the left",
            "the green cap is screwed onto the Coca-Cola",
            "the black cap is screwed onto the Mountain Dew",
        ],
        "steps": [
            "Take the green cap off the Mountain Dew",
            "Take the black cap off the Coca-Cola",
            "Swap the two bottles' places",
            "Put the green cap on the Coca-Cola",
            "Put the black cap on the Mountain Dew",
        ],
        "unordered": [4, 5],  # the two caps can go back on in either order
        "observe": 'Look at the most recent frame: a green Mountain Dew bottle and a Coca-Cola bottle with a red '
        'label on the floor. Reply ONLY JSON: {"left_bottle": "mountain dew"|"coca-cola", '
        '"mountain_dew_cap": "green cap on"|"black cap on"|"off", "coca_cola_cap": "black cap on"|"green cap on"|"off", '
        '"loose_caps_on_floor": ["green"|"black", ...], "hands_touching_bottles": true|false}',
    },
    "cup-pyramid": {
        "label": "Cup pyramid",
        "done_when": [
            "exactly 3 cups stand upside down side by side in a bottom row",
            "2 cups sit on top of the 3-cup bottom row (a bottom row with only 2 cups is wrong)",
            "1 cup sits on top of the 2-cup row",
            "all cups are nested into one single stack",
        ],
        "steps": [
            "Place 3 cups upside down in a row",
            "Put 2 cups on top",
            "Put 1 cup on top",
            "Take the pyramid down into one stack",
        ],
        "observe": 'Look at the most recent frame. Describe the clear plastic cups on the floor; count carefully, they '
        'are transparent. Reply ONLY JSON: {"bottom_row_cups": 0, "second_row_cups": 0, "top_row_cups": 0, '
        '"all_cups_in_one_nested_stack": true|false}',
    },
    "vast-astronaut": {
        "label": "VAST astronaut",
        "done_when": [
            "a round white base plate is on the floor",
            "white minifigure legs stand on the base plate",
            "a white torso with VAST on the chest sits on the legs",
            "a head with a white helmet is on the torso",
            "the navy staff or flag is in the figure's hand",
        ],
        "steps": [
            "Put the round base plate down",
            "Put the legs on the base",
            "Put the torso on the legs",
            "Put the head and helmet on",
            "Put the staff in its hand",
        ],
        "observe": 'Look closely at the small white Lego minifigure build on the floor. If hands hide it, say so. '
        'Reply ONLY JSON: {"hidden_by_hands": true|false, "base_plate_down": true|false, "legs_on_base": true|false, '
        '"torso_on_legs": true|false, "head_or_helmet_on": true|false, "staff_in_hand": true|false}',
    },
}


def _norm(v) -> str:
    return str(v or "").strip().lower()


def check_cap_swap(o: dict, cur: int) -> tuple[set[int], str]:
    dew, coke, left = _norm(o.get("mountain_dew_cap")), _norm(o.get("coca_cola_cap")), _norm(o.get("left_bottle"))
    loose = [_norm(c) for c in (o.get("loose_caps_on_floor") or []) if isinstance(c, str)]
    # a cap lying on the floor cannot also be on a bottle: trust the floor reading
    if "black" in loose:
        dew = "off" if dew == "black cap on" else dew
        coke = "off" if coke == "black cap on" else coke
    if "green" in loose:
        dew = "off" if dew == "green cap on" else dew
        coke = "off" if coke == "green cap on" else coke
    if dew == coke and dew.endswith("cap on"):
        dew = coke = "unclear"  # the same cap cannot be on both bottles
    hands = o.get("hands_touching_bottles") in (True, "true")
    vis = set()
    if dew != "green cap on":
        vis.add(1)
    if coke != "black cap on":
        vis.add(2)
    if "coca" in left:
        vis.add(3)
    if coke == "green cap on":
        vis |= {1, 4}
    if dew == "black cap on":
        vis |= {2, 5}
    issue = ""
    if hands:  # mid-action readings are noisy; correct only once the person lets go
        return vis, ""
    if cur >= 3 and dew == "green cap on" and "coca" in left:
        issue = "That green cap goes on the Coca-Cola, not the Mountain Dew."
    elif cur >= 3 and coke == "black cap on" and "coca" in left:
        issue = "The black cap goes on the Mountain Dew, not the Coca-Cola."
    elif cur == 2 and (4 in vis or 5 in vis) and 3 not in vis:
        issue = "Swap the two bottles before you put the caps back."
    return vis, issue


def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def check_cup_pyramid(o: dict, cur: int) -> tuple[set[int], str]:
    b, m, t = _int(o.get("bottom_row_cups")), _int(o.get("second_row_cups")), _int(o.get("top_row_cups"))
    nested = o.get("all_cups_in_one_nested_stack") in (True, "true")
    vis = set()
    if b >= 3:
        vis.add(1)
    if b >= 3 and m >= 2:
        vis |= {1, 2}
    if m >= 2 and t >= 1:
        vis |= {1, 2, 3}
    if nested and cur >= 3:
        vis.add(4)
    issue = ""
    if cur <= 1 and b == 2 and m >= 1:
        issue = "The bottom row needs 3 cups before you build on it."
    return vis, issue


def check_vast_astronaut(o: dict, cur: int) -> tuple[set[int], str]:
    if o.get("hidden_by_hands") in (True, "true"):
        return set(), ""
    keys = ["base_plate_down", "legs_on_base", "torso_on_legs", "head_or_helmet_on", "staff_in_hand"]
    vis = set()
    for i, k in enumerate(keys):
        if o.get(k) in (True, "true"):
            vis |= set(range(1, i + 2))  # a part on top means the parts under it are there
    issue = ""
    if o.get("head_or_helmet_on") in (True, "true") and o.get("torso_on_legs") not in (True, "true"):
        issue = "The torso goes on before the head."
    return vis, issue


TASK_CHECKS = {"cap-swap": check_cap_swap, "cup-pyramid": check_cup_pyramid, "vast-astronaut": check_vast_astronaut}


def task_def(task: str) -> tuple[str, dict] | tuple[None, None]:
    t = (task or "").strip().lower()
    for k, d in TASK_DEFS.items():
        if t in (k, d["label"].lower()):
            return k, d
    return None, None


app = FastAPI(title="Understudy server")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------ tracing (optional, cheap)

try:
    import weave

    if os.environ.get("WANDB_API_KEY") and os.environ.get("UNDERSTUDY_WEAVE", "1") != "0":
        weave.init(U.WANDB_PROJECT)
        op = weave.op
    else:
        raise RuntimeError("weave disabled")
except Exception as e:  # tracing must never block the demo
    print("weave off:", e)

    def op(*a, **k):
        if a and callable(a[0]):
            return a[0]
        return lambda f: f


def _drop_frames(inputs: dict) -> dict:
    return {k: (f"<{len(v)} frames>" if k == "frames" else v) for k, v in inputs.items()}


# ------------------------------------------------------------------ shared state

http: httpx.AsyncClient | None = None
_task_index: dict | None = None
_text_vec_cache: dict[str, np.ndarray] = {}


@app.on_event("startup")
async def _startup():
    global http
    http = httpx.AsyncClient(timeout=30)


def task_index() -> dict:
    global _task_index
    if _task_index is None or (TASK_INDEX.exists() and TASK_INDEX.stat().st_mtime > _task_index.get("_mtime", 0)):
        if TASK_INDEX.exists():
            _task_index = json.loads(TASK_INDEX.read_text())
            _task_index["_mtime"] = TASK_INDEX.stat().st_mtime
        else:
            _task_index = {"clusters": [], "_mtime": 0}
    return _task_index


def find_cluster(task: str) -> dict | None:
    t = (task or "").strip().lower()
    for c in task_index()["clusters"]:
        if c["id"].lower() == t or c["label"].lower() == t:
            return c
    return None


# ------------------------------------------------------------------ request parsing


def _shrink(jpeg: bytes, max_side: int = 480) -> bytes:
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(jpeg))).convert("RGB")
        im.thumbnail((max_side, max_side))
        out = io.BytesIO()
        im.save(out, "JPEG", quality=80)
        return out.getvalue()
    except Exception:
        return jpeg


def _decode_b64(s: str) -> bytes:
    if s.startswith("data:"):
        s = s.split(",", 1)[1]
    return base64.b64decode(s)


async def read_body(req: Request) -> tuple[dict, list[bytes]]:
    """JSON {frames:[b64|dataURL], ...} or multipart (frames files + text fields)."""
    ctype = req.headers.get("content-type", "")
    frames: list[bytes] = []
    data: dict[str, Any] = {}
    if "multipart/form-data" in ctype or "application/x-www-form-urlencoded" in ctype:
        form = await req.form()
        for k, v in form.multi_items():
            if hasattr(v, "read"):
                frames.append(await v.read())
            elif k == "frames":
                frames.append(_decode_b64(v))
            else:
                data[k] = v
    else:
        data = await req.json()
        frames = [_decode_b64(f) for f in data.pop("frames", []) or []]
    return data, frames


# ------------------------------------------------------------------ check-step

CHECK_SYSTEM = (
    "You are a strict but fair coach watching a live webcam of a person doing a hands-on task. "
    "You judge exactly one step at a time from a few frames (oldest first). "
    "Reply with JSON only, no prose."
)


def check_prompt(task: str, step: str, prev: str | None, nxt: str | None) -> str:
    ctx = ""
    if prev:
        ctx += f'Previous step (already done): "{prev}". '
    if nxt:
        ctx += f'Next step (not yet expected): "{nxt}". '
    return (
        f'Task: "{task}". Current step: "{step}". {ctx}\n'
        "Look at the frames, oldest first, and classify the current step:\n"
        '- "done": the frames clearly show this step completed or being finished.\n'
        '- "working": not finished yet, the person is preparing, idle, or still on it. This is the normal case.\n'
        '- "mistake": the person visibly does something wrong for this step: skips it and moves on to a later '
        "step, does it out of order, or does it unsafely or sloppily. Only use this when the error is visible.\n"
        'If "mistake", give "issue": one short spoken correction under 15 words addressed to them, e.g. '
        '"Put the blue brick on before the yellow one." Otherwise "issue" is "".\n'
        'Answer ONLY with JSON: {"state": "done"|"working"|"mistake", "issue": "..."}'
    )


@op(postprocess_inputs=_drop_frames)
async def cosmos_check_step(task: str, step: str, frames: list[bytes], prev: str | None = None, nxt: str | None = None) -> dict:
    raw = await U.reason(http, check_prompt(task, step, prev, nxt), frames, max_tokens=120, system=CHECK_SYSTEM)
    parsed = U.parse_json(raw)
    state = ""
    if isinstance(parsed, dict):
        state = str(parsed.get("state") or "").strip().lower()
        if not state and "done" in parsed:  # older schema
            d = parsed.get("done")
            state = "done" if (d is True or str(d).lower() in ("true", "yes", "1")) else "working"
        issue = str(parsed.get("issue") or "").strip()
    else:  # tolerate prose
        low = raw.lower()
        state = "done" if ('"done"' in low or low.startswith("yes")) else "mistake" if "mistake" in low else "working"
        issue = ""
    done = state == "done"
    if state != "mistake" or issue.lower() in ("", "none", "n/a", "null", "no issue", "-"):
        issue = ""
    return {"done": done, "state": state or "working", "issue": issue, "raw": raw[:300]}


JUDGE_SYSTEM = "You judge one step of a hands-on task from a vision model's scene report. Output strict JSON only."


def judge_prompt(label: str, steps: list[str], cur: int, obs: str, done_when: list[str] | None = None) -> str:
    listing = "\n".join(
        f"{i + 1}. {st}" + (f" (completed when: {done_when[i]})" if done_when and i < len(done_when) else "")
        for i, st in enumerate(steps)
    )
    return (
        f"Task: {label}. Steps in order:\n{listing}\n"
        f"What the camera sees right now (from a vision model, may be slightly noisy): {obs}\n"
        "Which steps are evidently completed? A step counts as completed if its result is visible now, or if the "
        "scene can only be explained by it having been done (e.g. a cup with drink in it means the bottle was "
        "opened and poured; a brick stacked on top means the brick or plate under it is there). The vision report "
        "can miss things, so missing evidence for an early setup step is NOT a skip. A step is NOT completed only "
        "when the report is consistent with it not having happened yet, or contradicts it (e.g. a different brick "
        "sits where that step's brick should be). Count a later step as completed whenever its own result is "
        "visible, even if an earlier step was skipped (e.g. a yellow brick on top counts the yellow step even "
        "when the blue one is missing).\n"
        'Also: ONLY if the report shows an object that should not be there (e.g. a brick of the wrong color in '
        'the place of the current step, or the wrong count), put one friendly spoken correction under 14 words in '
        '"wrong", e.g. "That should be a blue brick, not green." Something simply not done yet is NEVER wrong: '
        'then "wrong" is "".\n'
        'Reply ONLY JSON: {"completed": [step numbers], "wrong": "..."}'
    )


_llm_client = None
# Step judge: DeepSeek V4 Flash scored best on our sequence-logic cases (12/12, 11/12) at ~0.5 s.
JUDGE_MODEL = os.environ.get("UNDERSTUDY_JUDGE", "deepseek-ai/DeepSeek-V4-Flash")


def _judge_sync(prompt: str) -> str:
    global _llm_client
    if _llm_client is None:
        _llm_client = U.wandb_client()
    r = _llm_client.chat.completions.create(
        model=JUDGE_MODEL,
        messages=[{"role": "system", "content": JUDGE_SYSTEM}, {"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0,
    )
    return r.choices[0].message.content or ""


@op(postprocess_inputs=_drop_frames)
async def observe_and_judge(task_id: str, cur: int, frames: list[bytes]) -> dict:
    d = TASK_DEFS[task_id]
    t0 = time.perf_counter()
    sysmsg = "You are a precise vision sensor. Output only one JSON object, no prose."
    use = frames[-2:]
    raws = await asyncio.gather(*[U.reason(http, d["observe"], [f], max_tokens=160, system=sysmsg) for f in use])
    parsed = [U.parse_json(r) for r in raws]
    dicts = [x for x in parsed if isinstance(x, dict)]
    if len(dicts) >= 2:
        # keep only what both frames agree on; disagreement = unclear (never triggers a correction)
        a, b = dicts[-2], dicts[-1]
        obs = {}
        for k in set(a) | set(b):
            va, vb = a.get(k), b.get(k)
            if isinstance(va, list) and isinstance(vb, list):
                obs[k] = [x for x in va if x in vb]
            else:
                obs[k] = va if va == vb else "unclear"
    else:
        obs = dicts[-1] if dicts else None
    raw_obs = raws[-1]
    obs_text = json.dumps(obs) if obs is not None else raw_obs.strip()[:300]
    t1 = time.perf_counter()
    fn = TASK_CHECKS.get(task_id)
    if fn and isinstance(obs, dict):
        # fixed completion checks per step over Cosmos's structured scene report
        visible, wrong = fn(obs, cur)
        judge = "step-checks"
    else:
        raw = await asyncio.to_thread(_judge_sync, judge_prompt(d["label"], d["steps"], cur, obs_text, d.get("done_when")))
        p = U.parse_json(raw)
        p = p if isinstance(p, dict) else {}
        try:
            visible = {int(x) for x in (p.get("completed") or []) if 1 <= int(x) <= len(d["steps"])}
        except (TypeError, ValueError):
            visible = set()
        wrong = str(p.get("wrong") or "").strip()
        if wrong.lower() in ("none", "n/a", "null", "-", "no"):
            wrong = ""
        judge = JUDGE_MODEL
    t2 = time.perf_counter()
    # deterministic sequence logic on top of the LLM's per-step reading (1-based step numbers)
    if visible and 1 not in visible and judge != "step-checks":
        visible.add(1)  # step 1 is setup: later work visible means it happened (vision often misses flat plates)
    group = set(d.get("unordered") or [])
    advance = cur
    while (advance + 1) in visible:
        advance += 1
    hands_busy = isinstance(obs, dict) and any(
        "hands" in k and v in (True, "true") for k, v in obs.items()
    )
    skipped = [v for v in visible if v > cur + 1 and not ({v, cur + 1} <= group)]
    issue = ""
    if advance > cur:
        state = "done"
    elif skipped and not hands_busy:
        state = "mistake"
        issue = f"You skipped a step. {d['steps'][cur]} first."
        if wrong:
            issue = wrong
    elif wrong:
        state, issue = "mistake", wrong
    else:
        state = "working"
    return {
        "state": state,
        "issue": issue,
        "advance_to": advance,
        "completed_steps": sorted(visible),
        "observation": obs if obs is not None else obs_text,
        "judge": judge,
        "observe_ms": int((t1 - t0) * 1000),
        "judge_ms": int((t2 - t1) * 1000),
    }


@app.post("/api/check-step")
async def check_step(req: Request):
    t0 = time.perf_counter()
    data, frames = await read_body(req)
    step, task = data.get("step", ""), data.get("task", "")
    if not frames or not step:
        return JSONResponse({"done": False, "issue": "", "error": "need frames and step", "latency_ms": 0}, 400)
    frames = [_shrink(f, 960) for f in frames[-4:]]
    tid, d = task_def(task)
    cur = None
    if d:
        norm = lambda x: " ".join(str(x).lower().split())
        for i, st in enumerate(d["steps"]):
            if norm(st) == norm(step):
                cur = i
    try:
        if d and cur is not None:
            res = await observe_and_judge(tid, cur, frames)
            res["method"] = "cosmos-observe+llm-judge"
        else:  # unknown task/step text: single-pass Cosmos judgement
            res = await cosmos_check_step(task, step, frames, data.get("prev_step"), data.get("next_step"))
            res["method"] = "cosmos-single-pass"
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        return {"done": False, "state": "working", "issue": "", "error": f"{type(e).__name__}: {e}"[:200], "latency_ms": ms, "latencyMs": ms}
    ms = int((time.perf_counter() - t0) * 1000)
    out = {k: v for k, v in res.items() if k != "raw"}
    out.update({"done": res["state"] == "done", "latency_ms": ms, "latencyMs": ms, "model": U.REASON_MODEL, "judge_model": JUDGE_MODEL})
    return out


# ------------------------------------------------------------------ identify


def frames_to_mp4(frames: list[bytes], fps: int = 8) -> bytes:
    # Cosmos Embed samples 8 frames; shorter clips fail server-side, so stretch to >= 8.
    if len(frames) < 8:
        frames = [frames[i * len(frames) // 8] for i in range(8)]
    with tempfile.TemporaryDirectory() as d:
        for i, f in enumerate(frames):
            Path(d, f"f{i:03d}.jpg").write_bytes(f)
        out = Path(d, "clip.mp4")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", f"{d}/f%03d.jpg",
             "-vf", "scale=320:-2,format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(out)],
            check=True, timeout=20,
        )  # fmt: skip
        return out.read_bytes()


async def text_vec(text: str) -> np.ndarray:
    if text not in _text_vec_cache:
        v = np.array((await U.embed(http, [text]))[0], dtype=np.float32)
        _text_vec_cache[text] = v / (np.linalg.norm(v) + 1e-9)
    return _text_vec_cache[text]


def softmax_conf(sims: np.ndarray, temp: float) -> np.ndarray:
    z = (sims - sims.max()) / temp
    e = np.exp(z)
    return e / e.sum()


async def reason_pick(frames: list[bytes], cands: list[dict]) -> tuple[int | None, float]:
    names = [c["label"] for c in cands]
    desc = "; ".join(f'"{c["label"]}" ({c.get("prompt") or c["label"]})' for c in cands)
    prompt = (
        "Which task is set up or being done in these frames, judging by the objects on the table and the "
        f"person's hands? Options: {desc}. Pick the option whose objects are visible even if nobody has started "
        'yet. Only if none of these objects are visible at all, answer "none". '
        'Answer ONLY JSON: {"task": "<one option label exactly, or none>", "confidence": 0.0-1.0}'
    )
    # the Cosmos endpoint rejects more than 5 images per request
    step = max(1, len(frames) // 4)
    raw = await U.reason(http, prompt, frames[::step][-4:], max_tokens=60)
    p = U.parse_json(raw) or {}
    pick = str(p.get("task", "")).lower().strip() if isinstance(p, dict) else raw.lower()
    if not pick or pick == "none":
        return None, 0.0
    for i, n in enumerate(names):
        if n.lower() == pick or n.lower() in pick:
            return i, float(p.get("confidence", 0.7) or 0.7)
    return None, 0.0


@op(postprocess_inputs=_drop_frames)
async def identify_task(frames: list[bytes], cands: list[dict], method: str | None = None) -> dict:
    with_centroid = [c for c in cands if c.get("visual_centroid")]
    if method != "embed" and not (with_centroid and len(with_centroid) == len(cands)):
        i, c = await reason_pick(frames, cands)
        return {"i": i, "confidence": c, "method": "cosmos-reason-pick", "scores": None}
    if method != "reason":
        try:
            mp4 = await asyncio.to_thread(frames_to_mp4, frames)
            v = await asyncio.wait_for(
                U.embed(http, ["data:video/mp4;base64," + base64.b64encode(mp4).decode()]), timeout=10
            )
            v = np.array(v[0])
            v = v / (np.linalg.norm(v) + 1e-9)
            if with_centroid and len(with_centroid) == len(cands):
                sims = np.array([float(np.dot(v, np.array(c["visual_centroid"]))) for c in cands])
                conf = softmax_conf(sims, 0.02)
                used = "embed-nearest-task-cluster"
            else:
                sims = np.array([float(np.dot(v, await text_vec(c.get("prompt") or c["label"]))) for c in cands])
                conf = softmax_conf(sims, 0.03)
                used = "embed-zero-shot"
            i = int(np.argmax(sims))
            margin = float(np.sort(sims)[-1] - np.sort(sims)[-2]) if len(sims) > 1 else 1.0
            if used == "embed-nearest-task-cluster" or margin > 0.02 or method == "embed":
                return {"i": i, "confidence": float(conf[i]), "method": used, "scores": [round(float(s), 4) for s in sims]}
        except Exception as e:
            print("identify embed failed:", e)
    i, c = await reason_pick(frames, cands)
    return {"i": i, "confidence": c, "method": "cosmos-reason-pick", "scores": None}


@app.post("/api/identify")
async def identify(req: Request):
    t0 = time.perf_counter()
    data, frames = await read_body(req)
    if not frames:
        return JSONResponse({"error": "need frames"}, 400)
    frames = [_shrink(f, 320) for f in frames[-8:]]
    if len(frames) == 1:
        frames = frames * 4
    cands = data.get("tasks")
    if isinstance(cands, str):
        cands = json.loads(cands)
    if cands:
        cands = [{"id": c, "label": c} if isinstance(c, str) else c for c in cands]
        for c in cands:  # attach centroids for known ids/labels
            k = find_cluster(c.get("id") or c.get("label"))
            if k:
                c.setdefault("visual_centroid", k.get("visual_centroid"))
    else:
        ours = [c for c in task_index()["clusters"] if c["source"] == "ours"]
        cands = ours or DEFAULT_TASKS
    try:
        res = await identify_task(frames, cands, data.get("method"))
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        return {"task": None, "task_id": None, "confidence": 0.0, "error": f"{type(e).__name__}: {e}"[:200], "latency_ms": ms}
    ms = int((time.perf_counter() - t0) * 1000)
    if res["i"] is None:
        return {"task": None, "task_id": None, "confidence": 0.0, "method": res["method"], "latency_ms": ms}
    best = cands[res["i"]]
    return {
        "task": best["label"],
        "task_id": best.get("id"),
        "confidence": round(res["confidence"], 3),
        "method": res["method"],
        "candidates": [c.get("id") or c["label"] for c in cands],
        "scores": res["scores"],
        "latency_ms": ms,
    }


# ------------------------------------------------------------------ expert clip


@app.post("/api/expert-clip")
async def expert_clip(req: Request):
    data = await req.json()
    c = find_cluster(str(data.get("task", "")))
    i = int(data.get("step_index", 0) or 0)
    if not c or not (0 <= i < len(c.get("steps", []))):
        return {"url": None, "reason": "unknown task or step"}
    s = c["steps"][i]
    if not s.get("expert_url"):
        return {"url": None, "step": s["text"], "reason": "no expert recording for this task yet"}
    return {"url": s["expert_url"], "start_s": s.get("start_s", 0), "end_s": s.get("end_s"), "step": s["text"]}


# ------------------------------------------------------------------ feedback


def formula_score(steps: list[dict]) -> int:
    if not steps:
        return 0
    done = sum(1 for s in steps if s.get("done"))
    issues = sum(1 for s in steps if s.get("issue"))
    return max(0, min(100, round(100 * done / len(steps) - 7 * issues)))


@op
def llm_feedback(task: str, steps: list[dict]) -> dict:
    lines = "\n".join(
        f"{i + 1}. {s.get('text')}: {'done' if s.get('done') else 'NOT done'}"
        + (f" at {s.get('t')}s" if s.get("t") is not None else "")
        + (f" — correction given: {s['issue']}" if s.get("issue") else "")
        for i, s in enumerate(steps)
    )
    prompt = (
        f'A trainee just performed the task "{task}" while an AI coach watched. Step log:\n{lines}\n\n'
        "Score the attempt 0-100 (all steps done in order with no corrections = 90-100; each correction costs "
        "about 5-10; skipped steps cost more). Then write exactly two feedback sentences in a warm, specific "
        "coach voice, 10-20 words each, full sentences addressed to the trainee as 'you':\n"
        "1) what you did well, naming concrete steps;\n"
        "2) the one thing to do differently next time and why it matters for the result. If there were no "
        "corrections, make line 2 a concrete tip from the step timings instead (e.g. the slowest step).\n"
        'Example: ["You set up the base and stacked the red brick cleanly on the first try.", '
        '"Next time place the blue brick before the yellow one, or the tower is built in the wrong order."]\n'
        'Return ONLY JSON: {"score": int, "feedback": ["...", "..."]}'
    )
    raw = U.llm(prompt, system="You are a concise workplace trainer. Output strict JSON only.", max_tokens=250)
    return U.parse_json(raw) or {}


@app.post("/api/feedback")
async def feedback(req: Request):
    t0 = time.perf_counter()
    data = await req.json()
    task, steps = data.get("task", ""), data.get("steps", []) or []
    base = formula_score(steps)
    try:
        out = await asyncio.to_thread(llm_feedback, task, steps)
        score = int(out.get("score", base))
        fb = [str(x) for x in (out.get("feedback") or [])][:2]
    except Exception as e:
        print("feedback llm failed:", e)
        score, fb = base, []
    if abs(score - base) > 20:  # keep the number explainable
        score = round((score + base) / 2)
    while len(fb) < 2:
        fb.append("Good pace through the steps." if not fb else "Follow the step order shown by the expert clip.")
    return {"score": score, "feedback": fb, "latency_ms": int((time.perf_counter() - t0) * 1000), "model": U.LLM_MODEL}


# ------------------------------------------------------------------ library + health


@app.get("/api/library")
async def library():
    if SNAPSHOT.exists():
        return JSONResponse(json.loads(SNAPSHOT.read_text()))
    return JSONResponse({"error": "run build_map.py"}, 404)


async def _probe(name: str, coro) -> tuple[str, dict]:
    t0 = time.perf_counter()
    try:
        detail = await asyncio.wait_for(coro, timeout=8)
        return name, {"ok": True, "ms": int((time.perf_counter() - t0) * 1000), **(detail or {})}
    except Exception as e:
        return name, {"ok": False, "ms": int((time.perf_counter() - t0) * 1000), "error": f"{type(e).__name__}: {str(e)[:120]}"}


async def _vss():
    async with httpx.AsyncClient(base_url=U.INGRESS_URL, proxy=U.SOCKS, timeout=8) as c:
        r = await c.post(
            "/api/v1/auth/login", json={"username": os.environ["VSS_USERNAME"], "password": os.environ["VSS_PASSWORD"]}
        )
        r.raise_for_status()
        tok = r.json()["access_token"]
        s = await c.get("/api/v1/dashboard/stats", params={"scope": "all"}, headers={"Authorization": f"Bearer {tok}"})
        s.raise_for_status()
        o = s.json().get("overview", {})
        return {"videos": o.get("unique_videos"), "segments": o.get("segment_rows")}


async def _models(url: str):
    r = await http.get(f"{url}/models", headers={"Authorization": f"Bearer {U.GPU_TOKEN}"})
    r.raise_for_status()
    return {"model": r.json()["data"][0]["id"]}


async def _wandb():
    r = await http.get(
        f"{U.WANDB_URL}/models",
        headers={"Authorization": f"Bearer {os.environ['WANDB_API_KEY']}", "OpenAI-Project": U.WANDB_PROJECT},
    )
    r.raise_for_status()
    ids = [m["id"] for m in r.json().get("data", [])]
    return {"llm": U.LLM_MODEL, "llm_available": U.LLM_MODEL in ids}


@app.get("/api/health")
async def health():
    results = dict(
        await asyncio.gather(
            _probe("vss", _vss()),
            _probe("cosmos_reason", _models(U.REASON_URL)),
            _probe("cosmos_embed", _models(U.EMBED_URL)),
            _probe("wandb", _wandb()),
        )
    )
    idx = task_index()
    results["task_index"] = {
        "ok": bool(idx["clusters"]),
        "clusters": len(idx["clusters"]),
        "ours": sum(1 for c in idx["clusters"] if c["source"] == "ours"),
    }
    results["ok"] = all(v["ok"] for k, v in results.items() if k in ("cosmos_reason", "cosmos_embed", "wandb"))
    return results
