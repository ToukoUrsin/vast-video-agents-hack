"""Runs ON THE TEAM VM (inside the VAST network). Called by build_map.py over ssh.

Dumps every VastDB segment row (captions, detections, Cosmos Embed vectors) to rows.json,
picks a spread subset of archive segments per location, and extracts a 320 px JPEG
thumbnail per picked segment from S3. Our own task recordings (location == "understudy")
are always picked, and each take's full video is transcoded to a small MP4 for expert clips.

Usage on the VM:  .venv/bin/python vm_export.py [PER_LOCATION] [--refresh]
Reads credentials from ~/understudy/.env (copied from the Mac's .env.local).
"""

import json
import os
import subprocess
import sys
import tempfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import boto3
import urllib3
import vastdb

urllib3.disable_warnings()

HERE = os.path.expanduser("~/understudy")
OURS_LOCATION = "understudy"
env = dict(
    l.split("=", 1) for l in open(f"{HERE}/.env").read().splitlines() if "=" in l and not l.startswith("#")
)
norm = lambda u: u if u.startswith("http") else "http://" + u  # noqa: E731
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PER_LOC = int(args[0]) if args else 68

COLS = [
    "pk", "source", "filename", "segment_number", "segment_start_sec", "segment_end_sec",
    "reasoning_content", "object_classes", "object_counts", "detection_count", "vectors", "vectors_visual",
    "duration", "total_segments", "original_video", "camera_id", "capture_type", "location", "tags",
    "upload_timestamp", "extra_metadata", "is_public",
]  # fmt: skip

if os.path.exists(f"{HERE}/rows.json") and "--refresh" not in sys.argv:
    rows = json.load(open(f"{HERE}/rows.json"))
else:
    s = vastdb.connect(
        endpoint=norm(env.get("VDB_ENDPOINT") or env["S3_ENDPOINT"]),
        access=env["ACCESS_KEY"],
        secret=env["SECRET_KEY"],
        ssl_verify=False,
    )
    with s.transaction() as tx:
        t = (
            tx.bucket(env["VASTDB_BUCKET"])
            .schema(env.get("VDB_SCHEMA", "vss-schema"))
            .table(env.get("VDB_COLLECTION", "vss-collection"))
        )
        rows = t.select(columns=COLS).read_all().to_pylist()
    for r in rows:
        r["upload_timestamp"] = str(r["upload_timestamp"])
        r["vectors"] = list(r["vectors"] or [])
        r["vectors_visual"] = list(r["vectors_visual"] or [])
        r["tags"] = list(r.get("tags") or [])
print("rows", len(rows), file=sys.stderr)

# spread subset per archive location; all of ours
by_loc = defaultdict(list)
for r in rows:
    by_loc[r["location"]].append(r)
picked = []
for loc, rs in by_loc.items():
    rs.sort(key=lambda r: (r["camera_id"] or "", r["original_video"], r["segment_number"]))
    if loc == OURS_LOCATION:
        picked += rs
        continue
    n = min(PER_LOC, len(rs))
    step = len(rs) / n
    picked += [rs[int(i * step)] for i in range(n)]
sel = {r["source"] for r in picked}
for r in rows:
    r["selected"] = r["source"] in sel
json.dump(rows, open(f"{HERE}/rows.json", "w"))
print("selected", len(picked), file=sys.stderr)

s3 = boto3.client(
    "s3",
    verify=False,
    endpoint_url=norm(env["S3_ENDPOINT"]),
    aws_access_key_id=env["ACCESS_KEY"],
    aws_secret_access_key=env["SECRET_KEY"],
)
os.makedirs(f"{HERE}/thumbs", exist_ok=True)
os.makedirs(f"{HERE}/takes", exist_ok=True)


def split(uri):
    bucket, key = uri[5:].split("/", 1)
    return bucket, key


def thumb(r):
    out = f"{HERE}/thumbs/{r['pk']}.jpg"
    if os.path.exists(out):
        return True
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        try:
            s3.download_fileobj(*split(r["source"]), f)
            f.flush()
            mid = max(0.0, (r["duration"] or 5) / 2)
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-ss", f"{mid:.2f}", "-i", f.name,
                 "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", out],
                check=True, timeout=60,
            )  # fmt: skip
            return True
        except Exception as e:
            print("fail", r["source"], e, file=sys.stderr)
            return False


def take(uri):
    stem = os.path.splitext(os.path.basename(uri))[0]
    out = f"{HERE}/takes/{stem}.mp4"
    if os.path.exists(out):
        return True
    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(uri)[1] or ".mp4") as f:
        try:
            s3.download_fileobj(*split(uri), f)
            f.flush()
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", f.name, "-vf", "scale=640:-2", "-an",
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-movflags", "+faststart", out],
                check=True, timeout=300,
            )  # fmt: skip
            return True
        except Exception as e:
            print("take fail", uri, e, file=sys.stderr)
            return False


with ThreadPoolExecutor(8) as ex:
    ok = sum(ex.map(thumb, picked))
print("thumbs", ok, file=sys.stderr)
ours_videos = sorted({r["original_video"] for r in rows if r["location"] == OURS_LOCATION})
with ThreadPoolExecutor(4) as ex:
    ok = sum(ex.map(take, ours_videos))
print("takes", ok, "of", len(ours_videos), file=sys.stderr)
