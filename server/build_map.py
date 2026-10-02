"""Build the Library + Map snapshot from the real VSS archive (re-runnable).

  uv run build_map.py              # use cached server/cache/rows.json + thumbs
  uv run build_map.py --refresh    # re-export rows/thumbs/takes from VastDB + S3 via the team VM
  uv run build_map.py --no-llm     # skip W&B cluster naming (keeps generic labels)

Pipeline: VastDB rows (Cosmos Reason captions, YOLO classes, Cosmos Embed vectors)
  -> UMAP 2D layout of the caption vectors -> k-means clusters -> W&B LLM names each
  cluster (and writes its steps) -> web/src/data/real-archive.json + web/public/clips/*.jpg
  + server/task_index.json (centroids for /api/identify, steps + expert clips for the coach).

Our own task recordings (uploaded with upload_recording.py, location "understudy") become
source "ours": one clip per take, clustered by their task tag, steps learned from the best take.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from upstreams import LLM_MODEL, ROOT, llm, parse_json

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
CLIPS_DIR = ROOT / "web" / "public" / "clips"
OUT_JSON = ROOT / "web" / "src" / "data" / "real-archive.json"
TASK_INDEX = HERE / "task_index.json"
OURS_LOCATION = "understudy"

# VSS location -> UI site (ids match web/src/data/placeholder.ts so scene kinds line up)
SITES = {
    "warehouse3": {"id": "warehouse", "name": "SDG warehouse", "kind": "warehouse"},
    "nashville": {"id": "i24", "name": "Highway I-24", "kind": "highway"},
    "toronto": {"id": "toronto", "name": "Toronto PIE dashcam", "kind": "dashcam"},
    "neighborhood": {"id": "neighborhood", "name": "Neighborhood cam", "kind": "street"},
    "san_francisco": {"id": "sf", "name": "SF streets", "kind": "city"},
    "indoor": {"id": "smartspace", "name": "Indoor smart space", "kind": "indoor"},
    OURS_LOCATION: {"id": "studio", "name": "Our floor", "kind": "task-caps"},
}
STOCK_TINTS = ["#8FA2B4", "#93AEA7", "#A6A9AE", "#B79F9A", "#B3AC8F", "#9DA7BF", "#A3B39A", "#B8A7B5", "#9FB5B8"]
OURS_TINTS = ["#D2C3A6", "#A9BBA2", "#C9AC8E", "#C4B2C9", "#B9C7D6"]


def sh(cmd: str) -> None:
    print("+", cmd, file=sys.stderr)
    subprocess.run(cmd, shell=True, check=True)


def refresh(per_location: int) -> None:
    """Re-export from VastDB/S3 on the VM, then pull rows.json, thumbs/, takes/ back."""
    sh(f"scp -q {ROOT / '.env.local'} vastvm:understudy/.env && ssh vastvm 'chmod 600 ~/understudy/.env'")
    sh(f"scp -q {HERE / 'vm_export.py'} vastvm:understudy/vm_export.py")
    sh(
        "ssh vastvm 'cd ~/understudy && (test -x .venv/bin/python || (~/.local/bin/uv venv -q && "
        "~/.local/bin/uv pip install -q vastdb pyarrow boto3)) && "
        f".venv/bin/python vm_export.py {per_location} --refresh 2>&1 | grep -v \"RPC failed\" | tail -5'"
    )
    CACHE.mkdir(exist_ok=True)
    sh(f"ssh vastvm 'cd ~/understudy && tar czf - rows.json thumbs takes' | tar xzf - -C {CACHE}")


def unit(m: np.ndarray) -> np.ndarray:
    return m / (np.linalg.norm(m, axis=-1, keepdims=True) + 1e-9)


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "cluster"


def tag_value(tags: list[str], key: str) -> str | None:
    for t in tags or []:
        if t.startswith(key + ":"):
            return t.split(":", 1)[1]
    return None


def layout_2d(X: np.ndarray, seed: int = 42) -> np.ndarray:
    try:
        import umap

        return umap.UMAP(n_neighbors=30, min_dist=0.35, metric="cosine", random_state=seed).fit_transform(X)
    except Exception as e:  # pragma: no cover - fallback path
        print("UMAP failed, PCA+t-SNE fallback:", e, file=sys.stderr)
        from sklearn.decomposition import PCA
        from sklearn.manifold import TSNE

        return TSNE(2, init="pca", random_state=seed).fit_transform(PCA(30).fit_transform(X))


def name_clusters(groups: list[dict], use_llm: bool) -> list[dict]:
    """groups: [{captions:[...], classes:Counter, sites:Counter}] -> [{label, steps:[5 str]}]"""
    fallback = [
        {"label": f"Scene group {i + 1}", "steps": ["Enter frame", "Approach", "Main action", "Continue", "Leave frame"]}
        for i in range(len(groups))
    ]
    if not use_llm:
        return fallback
    blocks = []
    for i, g in enumerate(groups):
        caps = "\n".join(f"  - {c[:230]}" for c in g["captions"])
        blocks.append(
            f"Cluster {i}: sites={dict(g['sites'].most_common(3))} objects={[k for k, _ in g['classes'].most_common(5)]}\n{caps}"
        )
    prompt = (
        "These are clusters of 5-second video clips from cameras (highway, dashcam, streets, warehouse, indoor). "
        "Each cluster lists sample Cosmos Reason captions. For each cluster write:\n"
        '- "label": a short activity label, 2-4 words, sentence case, verb-led: actor + action (+ setting only '
        'if needed), like "Truck changing lanes", "Forklift moving pallet", "People crossing street", '
        '"Dashcam stopped at light". Never use vague words like "activity", "scene", "flowing", "operation". '
        "Labels must be clearly distinct; name what sets this cluster apart from the others "
        "(viewpoint, time of day, actor, action).\n"
        '- "steps": 5 very short phases (2-5 words each) of that activity in time order.\n'
        'Return ONLY a JSON array of objects {"cluster": int, "label": str, "steps": [str]} in cluster order.\n\n'
        + "\n\n".join(blocks)
    )
    try:
        out = parse_json(llm(prompt, system="You label video clusters. Output strict JSON only.", max_tokens=1500, temperature=0))
        if isinstance(out, dict):
            out = out.get("clusters") or ([out] if "label" in out else list(out.values())[0])
        res = list(fallback)
        for o in out or []:
            i = int(o.get("cluster", -1))
            if 0 <= i < len(res) and o.get("label"):
                steps = [str(s) for s in (o.get("steps") or [])][:5] or res[i]["steps"]
                res[i] = {"label": str(o["label"]).strip().rstrip("."), "steps": steps}
        return res
    except Exception as e:
        print("LLM naming failed, generic labels:", e, file=sys.stderr)
        return fallback


def learn_steps(task_label: str, segments: list[dict], use_llm: bool) -> list[dict]:
    """Steps for one of our tasks from the best take's segment captions -> [{text, start, end}]."""
    if not segments:
        return []
    timeline = "\n".join(
        f"[{s['segment_start_sec']:.0f}-{s['segment_end_sec']:.0f}s] {s['reasoning_content'][:400]}" for s in segments
    )
    if use_llm:
        prompt = (
            f'Task: "{task_label}". Below is a timeline of what Cosmos saw an expert do, per segment.\n{timeline}\n\n'
            "Extract the 4-6 key steps of the task in order. Each step: an imperative of 2-6 words a coach would say "
            '(e.g. "Put a red brick on it"), with start_s and end_s from the timeline where it happens, and '
            '"common_mistake": one short spoken correction for doing it wrong or skipping it. '
            'Return ONLY JSON: {"steps": [{"text": str, "start_s": number, "end_s": number, "common_mistake": str}]}'
        )
        try:
            out = parse_json(llm(prompt, system="You extract task steps. Output strict JSON only.", max_tokens=900))
            steps = out.get("steps") if isinstance(out, dict) else out
            if steps:
                return [
                    {
                        "text": str(s["text"]).strip().rstrip("."),
                        "start": float(s.get("start_s", 0)),
                        "end": float(s.get("end_s", 0)),
                        "common_mistake": s.get("common_mistake"),
                    }
                    for s in steps
                ]
        except Exception as e:
            print("LLM steps failed:", e, file=sys.stderr)
    return [
        {"text": s["reasoning_content"].split(".")[0][:60], "start": s["segment_start_sec"], "end": s["segment_end_sec"]}
        for s in segments[:5]
    ]


def short_caption(text: str, limit: int = 190) -> str:
    """First sentence or two of a Cosmos caption, for hover cards."""
    sents = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    out = ""
    for snt in sents:
        if out and len(out) + len(snt) + 1 > limit:
            break
        out = f"{out} {snt}".strip()
    return out if len(out) <= limit + 60 else out[:limit].rsplit(" ", 1)[0] + "…"


# Our tasks: clip-id prefix + tint match web/src/data/placeholder.ts; windows (s from take start) per step.
OURS_STYLE = {
    "cap-swap": {"prefix": "ours-caps", "tint": "#D2C3A6"},
    "cup-pyramid": {"prefix": "ours-cups", "tint": "#A9BBA2"},
    "vast-astronaut": {"prefix": "ours-astro", "tint": "#C9AC8E"},
}
EXPERT_WINDOWS = {
    "cap-swap": [(0, 6), (14, 21), (21, 26), (30, 39), (30, 39)],
    "cup-pyramid": [(2, 7), (7, 11), (12, 17), (17, 24)],
    "vast-astronaut": [(0, 4), (3, 8), (7, 12), (11, 16), (15, 19)],
}
RATINGS = {"cap-swap": [92, 88, 71], "cup-pyramid": [94, 90, 58], "vast-astronaut": [90, 86, 62]}


def load_task_defs() -> dict:
    """TASK_DEFS from server/app.py without importing it (app import starts the server stack)."""
    import ast

    tree = ast.parse((HERE / "app.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "TASK_DEFS" for t in node.targets):
            return ast.literal_eval(node.value)
    return {}


def summarize_takes(take_items: list[dict], use_llm: bool) -> dict[str, str]:
    """One short sentence per take from its Cosmos segment captions (for hover cards)."""
    if not take_items or not use_llm:
        return {}
    blocks = "\n\n".join(
        f"Take {i}: task={t['label']}\n" + "\n".join(f"  [{s['segment_start_sec']:.0f}s] {s['reasoning_content'][:300]}" for s in t["segs"])
        for i, t in enumerate(take_items)
    )
    prompt = (
        "Below are per-segment Cosmos Reason captions of short recordings of a person doing a task on the floor. "
        "For each take write ONE plain sentence (max 22 words) describing the actions in order (objects, hands). "
        "Describe only; do not judge quality or correctness. "
        'Return ONLY JSON: {"takes": [{"take": int, "caption": str}]}\n\n' + blocks
    )
    try:
        out = parse_json(llm(prompt, system="You summarize video captions. Output strict JSON only.", max_tokens=900)) or {}
        items = out.get("takes", out) if isinstance(out, dict) else out
        return {take_items[int(o["take"])]["video"]: str(o["caption"]).strip() for o in items if 0 <= int(o["take"]) < len(take_items)}
    except Exception as e:
        print("take captions failed:", e, file=sys.stderr)
        return {}


def free_spot(xy: np.ndarray) -> list[float]:
    """Emptiest point of the normalised layout, where placeholder takes can sit."""
    g = np.linspace(-0.9, 0.9, 19)
    pts = np.array([[a, b] for a in g for b in g])
    d = np.min(np.linalg.norm(pts[:, None, :] - xy[None, :, :], axis=-1), axis=1)
    return [round(float(v), 3) for v in pts[int(np.argmax(d))]]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--per-location", type=int, default=68)
    ap.add_argument("--k", type=int, default=8)
    ap.add_argument("--no-llm", action="store_true")
    a = ap.parse_args()
    use_llm = not a.no_llm

    if a.refresh or not (CACHE / "rows.json").exists():
        refresh(a.per_location)
    rows = json.load(open(CACHE / "rows.json"))
    rows = [r for r in rows if r.get("vectors") and r.get("location") in SITES]
    stock = [r for r in rows if r["location"] != OURS_LOCATION]
    ours_rows = [r for r in rows if r["location"] == OURS_LOCATION]
    print(f"rows: {len(stock)} archive, {len(ours_rows)} ours", file=sys.stderr)

    # ---- our takes: one item per original_video
    takes: dict[str, list[dict]] = defaultdict(list)
    for r in ours_rows:
        takes[r["original_video"]].append(r)
    take_items = []
    for vid, segs in sorted(takes.items()):
        segs.sort(key=lambda s: s["segment_number"])
        tags = segs[0].get("tags") or []
        stem = Path(vid).stem
        task_id = tag_value(tags, "task") or slug(segs[0].get("camera_id") or "task")
        take_items.append(
            {
                "video": vid,
                "stem": stem,
                "segs": segs,
                "task": task_id,
                "label": ((tag_value(tags, "label") or "").replace("_", " ") or task_id.replace("-", " ").capitalize()),
                "take": tag_value(tags, "take"),
                "score": int(tag_value(tags, "score")) if (tag_value(tags, "score") or "").isdigit() else None,
                "text": unit(np.mean([s["vectors"] for s in segs], axis=0)),
                "visual": unit(np.mean([s["vectors_visual"] for s in segs], axis=0)) if segs[0].get("vectors_visual") else None,
            }
        )

    # ---- layout: UMAP on caption vectors of all archive segments + our takes
    T = unit(np.array([r["vectors"] for r in stock] + [t["text"] for t in take_items], dtype=np.float32))
    xy = layout_2d(T)
    lo, hi = xy.min(0), xy.max(0)
    xy = (xy - lo) / (hi - lo + 1e-9) * 2 - 1
    xy_stock, xy_takes = xy[: len(stock)], xy[len(stock) :].copy()

    # ---- clusters on archive caption vectors
    from sklearn.cluster import KMeans

    km = KMeans(a.k, n_init=10, random_state=0).fit(T[: len(stock)])
    labels = km.labels_
    groups = []
    for c in range(a.k):
        idx = np.where(labels == c)[0]
        d = np.linalg.norm(T[idx] - km.cluster_centers_[c], axis=1)
        near = idx[np.argsort(d)]
        # nearest captions, de-duplicated by site so a mixed cluster shows its mix
        rng = np.random.default_rng(c)
        extra = rng.choice(near[10:], size=min(4, max(0, len(near) - 10)), replace=False) if len(near) > 10 else []
        caps = [stock[i]["reasoning_content"] for i in list(near[:6]) + list(extra)]
        classes = Counter(cl for i in idx for cl in (stock[i].get("object_classes") or "").split(",") if cl)
        sites = Counter(SITES[stock[i]["location"]]["name"] for i in idx)
        groups.append({"idx": idx, "near": near, "captions": caps, "classes": classes, "sites": sites})
    names = name_clusters(groups, use_llm)

    clusters, index = [], []
    used = set()
    stock_cluster_id = {}
    for c, (g, nm) in enumerate(zip(groups, names)):
        cid = slug(nm["label"])
        while cid in used:
            cid += "-2"
        used.add(cid)
        stock_cluster_id[c] = cid
        shown = [i for i in g["near"] if stock[i].get("selected")]
        expert = stock[shown[0]]["pk"] if shown else stock[g["near"][0]]["pk"]
        steps = [
            {"id": f"{cid}-{j + 1}", "text": s, "expert_clip_id": expert, "expert_start_s": 0, "expert_end_s": 5}
            for j, s in enumerate(nm["steps"])
        ]
        clusters.append({"id": cid, "label": nm["label"], "source": "stock", "tint": STOCK_TINTS[c % len(STOCK_TINTS)], "steps": steps})
        vis = [stock[i]["vectors_visual"] for i in g["idx"] if stock[i].get("vectors_visual")]
        index.append(
            {
                "id": cid,
                "label": nm["label"],
                "source": "stock",
                "size": int(len(g["idx"])),
                "text_centroid": [round(float(v), 5) for v in unit(km.cluster_centers_[c])],
                "visual_centroid": [round(float(v), 5) for v in unit(np.mean(vis, axis=0))] if vis else None,
                "steps": [{"text": s["text"], "expert_url": None} for s in steps],
                "sites": dict(g["sites"]),
            }
        )
        print(f"  {cid:32s} {len(g['idx']):5d}  {dict(g['sites'].most_common(3))}", file=sys.stderr)

    # ---- our takes all sit in one tight spot of the UMAP (same floor scene), on the crowded side of
    # the archive. For legibility place each task group at a fixed slot in the empty top-left region of
    # the layout; offsets of takes within a task keep their real UMAP direction (scaled x8).
    ours_offset = {}
    if take_items:
        slots = {"cap-swap": (-0.8, -0.8), "cup-pyramid": (-0.15, -0.9), "vast-astronaut": (-0.45, -0.45)}
        groups: dict[str, list[int]] = defaultdict(list)
        for i, t in enumerate(take_items):
            groups[t["task"]].append(i)
        orig = xy[len(stock) :]
        for j, (task, idx) in enumerate(sorted(groups.items())):
            c = orig[idx].mean(0)
            target = np.array(slots.get(task, (-0.6 + 0.3 * j, 0.0)))
            for i in idx:
                xy_takes[i] = target + (orig[i] - c) * 8
            ours_offset[task] = [round(float(v), 3) for v in (target - c)]

    # ---- noise: displayed archive points far from their cluster's 2D centre
    sel_idx = [i for i, r in enumerate(stock) if r.get("selected")]
    cent2d = {c: xy_stock[labels == c].mean(0) for c in range(a.k)}
    dist = np.array([np.linalg.norm(xy_stock[i] - cent2d[labels[i]]) for i in sel_idx])
    noise_cut = np.percentile(dist, 94) if len(dist) else 9e9

    clips = []
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    keep = set()
    for k, i in enumerate(sel_idx):
        r = stock[i]
        thumb = CACHE / "thumbs" / f"{r['pk']}.jpg"
        if not thumb.exists():
            continue
        shutil.copyfile(thumb, CLIPS_DIR / f"{r['pk']}.jpg")
        keep.add(f"{r['pk']}.jpg")
        clips.append(
            {
                "clip_id": r["pk"],
                "camera_id": r.get("camera_id") or "",
                "location": SITES[r["location"]]["id"],
                "source": "stock",
                "thumbnail_url": f"/clips/{r['pk']}.jpg",
                "video_url": None,
                "caption": short_caption(r["reasoning_content"]),
                "caption_full": r["reasoning_content"],
                "embedding2d": {"x": round(float(xy_stock[i][0]), 4), "y": round(float(xy_stock[i][1]), 4)},
                "cluster_id": None if dist[k] > noise_cut else stock_cluster_id[int(labels[i])],
                "duration_s": round(float(r.get("duration") or 5), 1),
                # extras (not in the TS type, harmless): provenance for hover cards / debugging
                "object_classes": [c for c in (r.get("object_classes") or "").split(",") if c],
                "vss_source": r["source"],
                "segment": [r.get("segment_number"), r.get("total_segments")],
            }
        )

    # ---- ours: one cluster per task. Steps come verbatim from server/app.py TASK_DEFS (the coach
    # checks against those exact strings); expert clip = take 1 in web/public/takes (made by the UI).
    task_defs = load_task_defs()
    by_task: dict[str, list[dict]] = defaultdict(list)
    for t, p in zip(take_items, xy_takes):
        t["xy"] = p
        by_task[t["task"]].append(t)
    take_caps = summarize_takes(take_items, use_llm)
    for task_id in sorted(by_task, key=lambda k: list(OURS_STYLE).index(k) if k in OURS_STYLE else 99):
        ts = sorted(by_task[task_id], key=lambda t: int(t["take"] or 9))
        tdef = task_defs.get(task_id, {})
        label = tdef.get("label") or ts[0]["label"]
        style = OURS_STYLE.get(task_id, {"prefix": f"ours-{task_id}", "tint": OURS_TINTS[0]})
        windows = EXPERT_WINDOWS.get(task_id, [])
        expert_id = f"{style['prefix']}-1"
        for t in ts:
            n_take = int(t["take"] or 1)
            score = t["score"] if t["score"] is not None else (RATINGS.get(task_id, [None] * 3)[n_take - 1] if n_take <= 3 else None)
            clips.append(
                {
                    "clip_id": f"{style['prefix']}-{n_take}",
                    "camera_id": t["segs"][0].get("camera_id") or "floor-cam1",
                    "location": "studio",
                    "source": "ours",
                    "thumbnail_url": f"/takes/{task_id}-{n_take}.jpg",
                    "video_url": f"/takes/{task_id}-{n_take}.mp4",
                    "caption": take_caps.get(t["video"]) or short_caption(t["segs"][0]["reasoning_content"]),
                    "caption_full": " ".join(s["reasoning_content"] for s in t["segs"]),
                    "embedding2d": {"x": round(float(t["xy"][0]), 4), "y": round(float(t["xy"][1]), 4)},
                    "cluster_id": task_id,
                    "score": score,
                    "score_kind": "take rating",
                    "take_quality": "sloppy" if n_take == 3 else "good",
                    "take_label": f"Take {n_take}",
                    "duration_s": round(float(max(s["segment_end_sec"] for s in t["segs"])), 1),
                    "vss_source": t["video"],
                    "segments": len(t["segs"]),
                }
            )
        step_texts = tdef.get("steps") or [f"Step {i + 1}" for i in range(len(windows) or 4)]
        steps = []
        for j, text in enumerate(step_texts):
            a_s, b_s = windows[j] if j < len(windows) else (j * 4, j * 4 + 4)
            steps.append(
                {
                    "id": f"{task_id}-{j + 1}",
                    "text": text,
                    "expert_clip_id": expert_id,
                    "expert_start_s": a_s,
                    "expert_end_s": b_s,
                    "expert_poster_url": f"/takes/{task_id}-step{j + 1}.jpg",
                }
            )
        clusters.append({"id": task_id, "label": label, "source": "ours", "tint": style["tint"], "steps": steps})
        vis = [t["visual"] for t in ts if t["visual"] is not None]
        index.append(
            {
                "id": task_id,
                "label": label,
                "source": "ours",
                "size": len(ts),
                "text_centroid": [round(float(v), 5) for v in unit(np.mean([t["text"] for t in ts], axis=0))],
                "visual_centroid": [round(float(v), 5) for v in unit(np.mean(vis, axis=0))] if vis else None,
                "steps": [
                    {"text": st["text"], "expert_url": f"/takes/{task_id}-1.mp4", "start_s": st["expert_start_s"], "end_s": st["expert_end_s"]}
                    for st in steps
                ],
            }
        )

    # remove stale clip files we own (jpg/mp4 not in this snapshot)
    for f in CLIPS_DIR.iterdir():
        if f.suffix in (".jpg", ".mp4") and f.name not in keep:
            f.unlink()

    sites = []
    present = Counter(c["location"] for c in clips)
    for loc, s in SITES.items():
        if s["id"] in present:
            sites.append({**s, "source": "ours" if loc == OURS_LOCATION else "stock"})

    ts_all = sorted(r["upload_timestamp"] for r in rows if r.get("upload_timestamp"))
    started = datetime.fromisoformat(ts_all[0]).replace(tzinfo=timezone.utc) if ts_all else datetime.now(timezone.utc)
    n_seg = len(rows)
    # Objects = sum of per-segment object_counts (max instances of each class in any frame), the same
    # quantity VSS dashboard/stats reports as instance_count. (detection_count is per-frame boxes, ~1000x larger.)
    objects = sum(sum(json.loads(r.get("object_counts") or "{}").values()) for r in rows)
    snapshot = {
        "sites": sites,
        "clips": clips,
        "clusters": clusters,
        "ingest": {
            "started_at": started.strftime("%b %-d, %H:%M UTC"),
            "replay_s": 9,
            "stages": [
                {"id": "segment", "label": "Segment", "total": n_seg, "unit": "clips"},
                {"id": "detect", "label": "Detect", "model": "YOLO11", "total": objects, "unit": "objects"},
                {"id": "describe", "label": "Describe", "model": "Cosmos Reason", "total": n_seg, "unit": "captions"},
                {"id": "embed", "label": "Embed", "model": "Cosmos Embed", "total": n_seg, "unit": "vectors"},
                {"id": "store", "label": "VastDB", "total": n_seg, "unit": "rows"},
            ],
        },
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "videos": len({r["original_video"] for r in rows}),
            "segments": n_seg,
            "shown_clips": len(clips),
            "layout": "UMAP(cosine) of Cosmos Embed caption vectors",
            "clustering": f"k-means k={a.k} on Cosmos Embed caption vectors",
            "label_model": LLM_MODEL if use_llm else None,
            "ours_layout": "task groups placed in the empty top-left of the map; take offsets within a task from UMAP x8",
            "ours_offset": ours_offset,
            "free_spot": free_spot(np.array([[c["embedding2d"]["x"], c["embedding2d"]["y"]] for c in clips if c["source"] == "stock"])),
        },
    }
    OUT_JSON.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
    TASK_INDEX.write_text(json.dumps({"generated_at": snapshot["meta"]["generated_at"], "clusters": index}))
    print(f"wrote {OUT_JSON}: {len(clips)} clips, {len(clusters)} clusters", file=sys.stderr)
    for c in clusters:
        print(f"  [{c['source']}] {c['label']}: {' / '.join(s['text'] for s in c['steps'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
