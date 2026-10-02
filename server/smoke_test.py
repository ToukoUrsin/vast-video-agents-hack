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
call("check-step (json)", "POST", "/api/check-step", json={"frames": frames[:1] * 4, "step": "Put a blue brick on the red one", "task": "Lego assembly"})
call("check-step (json, 4 frames)", "POST", "/api/check-step", json={"frames": frames[:4], "step": "Put a blue brick on the red one", "task": "Lego assembly"})
files = [("frames", (f"f{i}.jpg", open(p, "rb").read(), "image/jpeg")) for i, p in enumerate(paths[:4])]
call("check-step (multipart)", "POST", "/api/check-step", data={"step": "Sit down at a table", "task": "Attending a workshop"}, files=files)
call("identify (default tasks)", "POST", "/api/identify", json={"frames": frames[:1] * 4})
call("identify (custom tasks)", "POST", "/api/identify", json={"frames": frames[1:2] * 4, "tasks": ["Driving on a highway", "Lego assembly", "Cup pyramid"]})
call("identify (reason)", "POST", "/api/identify", json={"frames": frames[:1], "method": "reason"})
call("expert-clip", "POST", "/api/expert-clip", json={"task": "lego-tower", "step_index": 1})
call("feedback", "POST", "/api/feedback", json={
    "task": "Lego assembly",
    "steps": [
        {"text": "Place the base plate flat on the table", "done": True, "issue": "", "t": 4},
        {"text": "Put a red brick on it", "done": True, "issue": "", "t": 9},
        {"text": "Put a blue brick on the red one", "done": True, "issue": "Put the blue brick on before the yellow one.", "t": 18},
        {"text": "Put a yellow brick on top", "done": True, "issue": "", "t": 22},
        {"text": "Push the finished tower to the right side", "done": True, "issue": "", "t": 27},
    ],
})
