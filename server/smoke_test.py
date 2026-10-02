"""Hit every endpoint of a running server with real frames and print latencies.

  uv run smoke_test.py [path/to/frame.jpg ...]     (default: /tmp/IMG_0483.jpg + 3 archive thumbnails)
"""

import base64
import glob
import json
import sys
import time

import httpx

BASE = "http://127.0.0.1:8787"
paths = sys.argv[1:] or (["/tmp/IMG_0483.jpg"] + sorted(glob.glob("../web/public/clips/*.jpg"))[:3])
frames = [base64.b64encode(open(p, "rb").read()).decode() for p in paths]
c = httpx.Client(base_url=BASE, timeout=60)


def call(name, method, path, **kw):
    t = time.perf_counter()
    r = c.request(method, path, **kw)
    ms = int((time.perf_counter() - t) * 1000)
    body = r.json()
    short = {k: v for k, v in body.items() if k not in ("clips", "sites", "clusters")} if isinstance(body, dict) else body
    print(f"{name:28s} {r.status_code} {ms:5d} ms  {json.dumps(short)[:300]}")
    return body


call("health", "GET", "/api/health")
call("check-step (json)", "POST", "/api/check-step", json={"frames": frames[:1] * 4, "step": "Tape the bottom seam", "task": "Packing a box"})
call("check-step (json, 4 frames)", "POST", "/api/check-step", json={"frames": frames[:4], "step": "Tape the bottom seam", "task": "Packing a box"})
files = [("frames", (f"f{i}.jpg", open(p, "rb").read(), "image/jpeg")) for i, p in enumerate(paths[:4])]
call("check-step (multipart)", "POST", "/api/check-step", data={"step": "Sit down at a table", "task": "Attending a workshop"}, files=files)
call("identify (default tasks)", "POST", "/api/identify", json={"frames": frames[:1] * 4})
call("identify (custom tasks)", "POST", "/api/identify", json={"frames": frames[1:2] * 4, "tasks": ["Driving on a highway", "Packing a box", "Making tea"]})
call("identify (reason)", "POST", "/api/identify", json={"frames": frames[:1], "method": "reason"})
call("expert-clip", "POST", "/api/expert-clip", json={"task": "packing-box", "step_index": 1})
call("feedback", "POST", "/api/feedback", json={
    "task": "Packing a box",
    "steps": [
        {"text": "Fold bottom flaps", "done": True, "issue": "", "t": 4},
        {"text": "Tape the bottom seam", "done": True, "issue": "Tape the bottom seam before the item goes in.", "t": 15},
        {"text": "Insert item", "done": True, "issue": "", "t": 19},
        {"text": "Close top flaps", "done": True, "issue": "", "t": 24},
        {"text": "Tape and label", "done": True, "issue": "", "t": 31},
    ],
})
