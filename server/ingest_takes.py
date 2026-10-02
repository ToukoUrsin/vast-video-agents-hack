"""Ingest our recorded takes into the team VastDB ourselves (the DataEngine segmenter does not run
for teams). Mirrors what the VSS pipeline writes for every archive row:

  5 s segments -> YOLO11 (perception) -> Cosmos Reason caption (our step-by-step prompt)
  -> Cosmos Embed text vector (caption, request_type=query) + visual vector (segment video)
  -> segment mp4 in team-39-vss-chunks-segments/segments/<stem>_segment_NNN_of_MMM.mp4
  -> one row per segment in vss-collection (pk = md5(source)), insert only.

  uv run ingest_takes.py            # process locally, then upload + insert on the VM
  uv run ingest_takes.py --local    # only build cache/ingest/ (segments + rows.json)

The originals were already uploaded to team-39-vss-chunks via /api/v1/videos/upload; their keys are
looked up on the VM by the original-filename metadata (a missing original is uploaded the same way).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import math
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

import upstreams as U
from upload_recording import STEP_PROMPT

HERE = Path(__file__).resolve().parent
REC = U.ROOT / "recordings"
OUT = HERE / "cache" / "ingest"
SEG_S = 5.0
SEG_BUCKET = "team-39-vss-chunks-segments"
CHUNK_BUCKET = "team-39-vss-chunks"
TASKS = {"cups": ("cup-pyramid", "Cup pyramid"), "lego": ("vast-astronaut", "VAST astronaut"), "pour": ("cap-swap", "Cap swap")}
YOLO_URL = "http://166.19.38.112:8002/v1/infer"


def sh(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def duration(p: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
        check=True, capture_output=True, text=True,
    )  # fmt: skip
    return float(out.stdout.strip())


def b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode()


async def caption(c: httpx.AsyncClient, small: Path, label: str) -> tuple[str, int]:
    content = [
        {"type": "video_url", "video_url": {"url": "data:video/mp4;base64," + b64(small)}},
        {"type": "text", "text": STEP_PROMPT.format(label=label)},
    ]
    r = await c.post(
        f"{U.REASON_URL}/chat/completions",
        headers={"Authorization": f"Bearer {U.GPU_TOKEN}"},
        json={"model": U.REASON_MODEL, "messages": [{"role": "user", "content": content}], "max_tokens": 700, "temperature": 0},
        timeout=120,
    )
    r.raise_for_status()
    j = r.json()
    msg = j["choices"][0]["message"]
    text = " ".join((msg.get("content") or "").split())  # embedder rejects newlines; archive captions are one paragraph
    return text, int(j.get("usage", {}).get("total_tokens", 0))


async def yolo(c: httpx.AsyncClient, seg: Path, name: str) -> dict:
    try:
        r = await c.post(
            YOLO_URL,
            headers={"Authorization": f"Bearer {U.GPU_TOKEN}"},
            json={"video_base64": b64(seg), "filename": name, "include_frames": False},
            timeout=120,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print("  yolo failed:", e, file=sys.stderr)
        return {}


async def process_take(c: httpx.AsyncClient, f: Path, sem: asyncio.Semaphore) -> list[dict]:
    kind, q = f.stem.split("-")
    task, label = TASKS[kind]
    take = 3 if q == "sloppy" else int(q)
    dur = duration(f)
    n = math.ceil(dur / SEG_S - 0.3)  # drop a trailing sliver under 1.5 s
    work = OUT / f.stem
    work.mkdir(parents=True, exist_ok=True)
    rows = []

    async def one(i: int) -> dict:
        start = i * SEG_S
        end = min(dur, start + SEG_S)
        seg = work / f"seg{i + 1:03d}.mp4"
        small = work / f"seg{i + 1:03d}_480.mp4"
        if not seg.exists():
            await asyncio.to_thread(sh, ["ffmpeg", "-v", "error", "-y", "-ss", f"{start}", "-t", f"{end - start}", "-i", str(f),
                                         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an", "-movflags", "+faststart", str(seg)])  # fmt: skip
            await asyncio.to_thread(sh, ["ffmpeg", "-v", "error", "-y", "-i", str(seg), "-vf", "scale=-2:480", "-c:v", "libx264",
                                         "-preset", "veryfast", "-crf", "26", "-an", str(small)])  # fmt: skip
        async with sem:
            t0 = time.perf_counter()
            (cap, tokens), det, vis = await asyncio.gather(
                caption(c, small, label),
                yolo(c, small, seg.name),
                U.embed(c, ["data:video/mp4;base64," + b64(small)]),
            )
            txt = (await U.embed(c, [cap]))[0]
            proc = time.perf_counter() - t0
        print(f"  {f.stem} seg {i + 1}/{n} {proc:.1f}s  {cap[:80]!r}", file=sys.stderr)
        return {
            "i": i, "start": start, "end": end, "seg": str(seg), "caption": cap, "tokens": tokens,
            "det": det, "vectors": txt, "vectors_visual": vis[0], "processing_time": proc,
        }  # fmt: skip

    segs = await asyncio.gather(*(one(i) for i in range(n)))
    for s in segs:
        rows.append({"take_file": f.name, "task": task, "label": label, "take": take, "total": n, **s})
    return rows


RATINGS = {"cap-swap": [92, 88, 71], "cup-pyramid": [94, 90, 58], "vast-astronaut": [90, 86, 62]}


def clean_caption(text: str) -> str:
    """Drop repeated sentences (the reasoner sometimes loops on short clips)."""
    import re

    seen, out = set(), []
    for snt in re.split(r"(?<=[.!?])\s+", text.strip()):
        k = snt.strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(snt.strip())
    return " ".join(out)


def build_rows(segs: list[dict], keys: dict[str, dict]) -> list[dict]:
    rows = []
    for s in segs:
        meta = keys[s["take_file"]]
        stem = Path(meta["key"]).stem
        fname = f"{stem}_segment_{s['i'] + 1:03d}_of_{s['total']:03d}.mp4"
        source = f"s3://{SEG_BUCKET}/segments/{fname}"
        det = dict(s["det"] or {})
        pj = det.get("perception_json") if isinstance(det.get("perception_json"), dict) else {}
        for k in ("frame_count", "detection_count", "max_detection_conf", "object_counts_mode"):
            det.setdefault(k, pj.get(k))
        classes = sorted(det.get("object_classes") or [])
        counts = det.get("object_counts") or {}
        perception = {
            "source": "yolo11_coco",
            "object_classes": classes,
            "object_counts": counts,
            "object_counts_mode": det.get("object_counts_mode") or "total",
            "max_detection_conf": det.get("max_detection_conf"),
            "frame_count": det.get("frame_count"),
            "detection_count": det.get("detection_count"),
        }
        rows.append(
            {
                "pk": hashlib.md5(source.encode()).hexdigest(),
                "source": source,
                "filename": fname,
                "segment_number": s["i"] + 1,
                "segment_start_sec": float(s["start"]),
                "segment_end_sec": float(s["end"]),
                "reasoning_content": clean_caption(s["caption"]),
                "perception_json": json.dumps(perception),
                "object_classes": ",".join(classes),
                "object_counts": json.dumps(counts),
                "max_detection_conf": float(det.get("max_detection_conf") or 0.0),
                "perception_ok": bool(det.get("perception_ok", bool(det))),
                "perception_source": "yolo11_coco",
                "detection_sidecar_uri": None,
                "detection_frame_count": int(det.get("frame_count") or 0),
                "detection_count": int(det.get("detection_count") or 0),
                "vectors": s["vectors"],
                "vectors_visual": s["vectors_visual"],
                "cosmos_model": U.REASON_MODEL,
                "embedding_model": U.EMBED_MODEL,
                "visual_embedding_model": U.EMBED_MODEL,
                "tokens_used": int(s["tokens"]),
                "cached_prompt_tokens": 0,
                "processing_time": float(s["processing_time"]),
                "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                "allowed_users": ["team-39"],
                "is_public": True,
                "upload_timestamp": meta["upload_timestamp"],
                "duration": round(float(s["end"] - s["start"]), 3),
                "total_segments": s["total"],
                "original_video": f"s3://{CHUNK_BUCKET}/{meta['key']}",
                "tags": [t for t in meta["tags"] if not t.startswith("score:")]
                + [f"score:{RATINGS[s['task']][s['take'] - 1]}"],
                "camera_id": "floor-cam1",
                "capture_type": "general",
                "location": "understudy",
                "extra_metadata": json.dumps(
                    {
                        "status": "success",
                        "embedding_dimensions": 256,
                        "visual_embedding_dimensions": 256,
                        "visual_embedding_ok": True,
                        "chunk_index": 0,
                        "chunk_start_sec": 0.0,
                        "stream_position_sec": float(s["start"]),
                        "ingest_kind": "batch_chunk",
                        "ingested_by": "understudy/ingest_takes.py",
                    }
                ),
                "_local_seg": s["seg"],
            }
        )
    return rows


async def main_async(files: list[Path]) -> list[dict]:
    sem = asyncio.Semaphore(6)
    async with httpx.AsyncClient(timeout=120) as c:
        out = []
        for res in await asyncio.gather(*(process_take(c, f, sem) for f in files)):
            out += res
        return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true")
    ap.add_argument("--only", help="comma list of take stems, e.g. pour-1")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in REC.glob("*.mp4") if p.stem.split("-")[0] in TASKS)
    if a.only:
        files = [f for f in files if f.stem in a.only.split(",")]

    seg_cache = OUT / "segments.json"
    segs = json.loads(seg_cache.read_text()) if seg_cache.exists() and not a.only else None
    if segs is None:
        segs = asyncio.run(main_async(files))
        if not a.only:
            seg_cache.write_text(json.dumps(segs))
    print(f"{len(segs)} segments from {len(files)} takes", file=sys.stderr)
    if a.local:
        return

    # resolve uploaded originals on the VM (uploads the missing ones the same way the backend does)
    subprocess.run(f"scp -q {HERE / 'vm_ingest.py'} vastvm:understudy/vm_ingest.py", shell=True, check=True)
    missing = [f.name for f in files]
    res = subprocess.run(
        ["ssh", "vastvm", f"cd ~/understudy && .venv/bin/python vm_ingest.py resolve {' '.join(missing)}"],
        check=True, capture_output=True, text=True,
    )  # fmt: skip
    keys = json.loads(res.stdout)
    need = [n for n, v in keys.items() if v is None]
    if need:
        print("uploading missing originals:", need, file=sys.stderr)
        for n in need:
            subprocess.run(f"scp -q {REC / n} vastvm:understudy/upload_{n}", shell=True, check=True)
        res = subprocess.run(
            ["ssh", "vastvm", f"cd ~/understudy && .venv/bin/python vm_ingest.py upload {' '.join(need)}"],
            check=True, capture_output=True, text=True,
        )  # fmt: skip
        keys.update(json.loads(res.stdout))
    rows = build_rows(segs, keys)
    (OUT / "rows.json").write_text(json.dumps(rows))
    # ship segments + rows, then upload + insert on the VM
    subprocess.run("ssh vastvm 'mkdir -p ~/understudy/ingest/segs'", shell=True, check=True)
    tar = " ".join(str(Path(r["_local_seg"]).relative_to(OUT)) for r in rows)
    subprocess.run(f"tar cf - -C {OUT} {tar} rows.json | ssh vastvm 'tar xf - -C ~/understudy/ingest'", shell=True, check=True)
    subprocess.run(["ssh", "vastvm", "cd ~/understudy && .venv/bin/python vm_ingest.py insert ingest/rows.json"], check=True)


if __name__ == "__main__":
    main()
