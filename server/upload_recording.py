"""Upload our own task recordings to VSS so the real pipeline indexes them
(segment -> YOLO -> Cosmos Reason with our step-by-step prompt -> Cosmos Embed -> VastDB).

  uv run upload_recording.py takes/box_1.mp4 --task packing-box --label "Packing a box" --take 1 --score 94
  uv run upload_recording.py takes/box_3.mp4 --task packing-box --take 3 --score 52   # sloppy take
  uv run upload_recording.py ... --dry-run      # print the request, upload nothing

Metadata convention read back by build_map.py:
  location=understudy, camera_id=<--camera>, capture_type=general,
  tags: understudy, task:<id>, take:<n>, label:<label with _ for spaces>, score:<0-100 optional>
Long videos are re-encoded to 720p if they exceed the backend upload limit.
After the pipeline finishes (minutes), run:  uv run build_map.py --refresh
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from upstreams import VSS

STEP_PROMPT = (
    "This video shows a person performing a hands-on task at a workbench: {label}. "
    "Describe each step of the task being performed, in order, as short imperative steps "
    "(for example 'Fold the bottom flaps', 'Tape the bottom seam'). For each step say what the hands "
    "do, which objects and tools are used, and whether it was done correctly and completely. "
    "Point out anything skipped, done out of order, or done sloppily. "
    "Be concrete and visual; do not guess at things not visible."
)


def ensure_size(path: Path, max_mb: int) -> Path:
    if path.stat().st_size <= max_mb * 1024 * 1024 * 0.95:
        return path
    out = Path(tempfile.mkdtemp()) / (path.stem + "_720p.mp4")
    print(f"  {path.name} is over {max_mb} MB, re-encoding to 720p...", file=sys.stderr)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(path), "-vf", "scale=-2:720", "-c:v", "libx264",
         "-preset", "veryfast", "-crf", "26", "-c:a", "aac", "-b:a", "96k", str(out)],
        check=True,
    )  # fmt: skip
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--task", required=True, help="task id, e.g. packing-box")
    ap.add_argument("--label", help='display label, e.g. "Packing a box" (default from --task)')
    ap.add_argument("--take", type=int, help="take number of the first file; later files count up (default 1)")
    ap.add_argument("--score", type=int, help="optional quality score 0-100 for this take")
    ap.add_argument("--camera", default="bench-cam1")
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    label = a.label or a.task.replace("-", " ").capitalize()
    prompt = STEP_PROMPT.format(label=label)
    assert len(prompt) <= 800, "custom_prompt max is 800 chars"

    vss = VSS(timeout=600)
    if not a.dry_run:
        vss.login()
        cfg = vss.get("/api/v1/config").get("app", {})
        max_mb = int(cfg.get("max_upload_size_mb", 100))
        allowed = set(cfg.get("allowed_video_extensions", [".mp4", ".mov", ".webm", ".avi", ".mkv"]))
    else:
        max_mb, allowed = 100, {".mp4", ".mov", ".webm", ".avi", ".mkv"}

    for n, f in enumerate(a.files, start=1):
        if f.suffix.lower() not in allowed:
            print(f"skip {f}: extension not allowed", file=sys.stderr)
            continue
        take = (a.take or 1) + n - 1
        tags = ["understudy", f"task:{a.task}", f"take:{take}", "label:" + label.replace(" ", "_")]
        if a.score is not None:
            tags.append(f"score:{a.score}")
        form = {
            "is_public": "false" if a.private else "true",
            "tags": ",".join(tags),
            "custom_prompt": prompt,
            "camera_id": a.camera,
            "capture_type": "general",
            "location": "understudy",
        }
        print(f"{f.name}: {form['tags']}", file=sys.stderr)
        if a.dry_run:
            print("  dry run, prompt:", prompt, file=sys.stderr)
            continue
        src = ensure_size(f, max_mb)
        with open(src, "rb") as fh:
            r = vss.request("POST", "/api/v1/videos/upload", data=form, files={"file": (f.name, fh, "video/mp4")})
        if r.status_code >= 400:
            print(f"  FAILED {r.status_code}: {r.text[:300]}", file=sys.stderr)
            continue
        print(f"  ok: {r.json().get('object_key')}", file=sys.stderr)
    if not a.dry_run:
        print("Pipeline runs async. Check: uv run python -c \"from upstreams import VSS; v=VSS(); "
              "print(v.get('/api/v1/videos/explore', scope='mine', limit=20, offset=0)['total'])\"", file=sys.stderr)


if __name__ == "__main__":
    main()
