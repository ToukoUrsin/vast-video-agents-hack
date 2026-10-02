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
    {"id": "packing-box", "label": "Packing a box", "prompt": "a person folding, taping and packing a cardboard box on a table"},
    {"id": "making-tea", "label": "Making tea", "prompt": "a person making tea with a kettle, a cup and a tea bag"},
    {"id": "safety-gear", "label": "Putting on safety gear", "prompt": "a person putting on a hi-vis vest, safety glasses, gloves and a hard hat"},
]

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
        '"Tape the bottom seam before the item goes in." Otherwise "issue" is "".\n'
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


@app.post("/api/check-step")
async def check_step(req: Request):
    t0 = time.perf_counter()
    data, frames = await read_body(req)
    step, task = data.get("step", ""), data.get("task", "")
    if not frames or not step:
        return JSONResponse({"done": False, "issue": "", "error": "need frames and step", "latency_ms": 0}, 400)
    frames = [_shrink(f) for f in frames[-4:]]
    try:
        res = await cosmos_check_step(task, step, frames, data.get("prev_step"), data.get("next_step"))
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        return {"done": False, "issue": "", "error": f"cosmos: {type(e).__name__}", "latency_ms": ms, "latencyMs": ms}
    ms = int((time.perf_counter() - t0) * 1000)
    return {"done": res["done"], "state": res["state"], "issue": res["issue"], "latency_ms": ms, "latencyMs": ms, "model": U.REASON_MODEL}


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


async def reason_pick(frames: list[bytes], cands: list[dict]) -> tuple[int, float]:
    names = [c["label"] for c in cands]
    prompt = (
        "Which task is the person in these frames starting? Options: "
        + "; ".join(f'"{n}"' for n in names)
        + '. Answer ONLY JSON: {"task": "<one option exactly>", "confidence": 0.0-1.0}'
    )
    raw = await U.reason(http, prompt, frames, max_tokens=60)
    p = U.parse_json(raw) or {}
    pick = str(p.get("task", "")).lower()
    for i, n in enumerate(names):
        if n.lower() == pick or n.lower() in pick:
            return i, float(p.get("confidence", 0.7) or 0.7)
    return 0, 0.3


@op(postprocess_inputs=_drop_frames)
async def identify_task(frames: list[bytes], cands: list[dict], method: str | None = None) -> dict:
    with_centroid = [c for c in cands if c.get("visual_centroid")]
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
    res = await identify_task(frames, cands, data.get("method"))
    best = cands[res["i"]]
    ms = int((time.perf_counter() - t0) * 1000)
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
        "about 5-10; skipped steps cost more). Then write exactly two short feedback lines (max 18 words each): "
        "first what went well, second the single most useful thing to fix next time, referencing the step.\n"
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
