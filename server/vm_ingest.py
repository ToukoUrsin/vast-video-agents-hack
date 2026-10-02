"""Runs ON THE TEAM VM. Helper for ingest_takes.py (insert-only writes to the team VastDB/S3).

  vm_ingest.py resolve <file.mp4 ...>   -> JSON {name: {key, tags, upload_timestamp} | null} from chunks bucket metadata
  vm_ingest.py upload  <file.mp4 ...>   -> uploads ~/understudy/upload_<name> as a new original (backend key/metadata style)
  vm_ingest.py insert  ingest/rows.json -> puts segment mp4s into the segments bucket, inserts rows whose pk is new
"""

import json
import os
import secrets
import sys
from datetime import datetime, timezone
from urllib.parse import quote

import boto3
import pyarrow as pa
import urllib3
import vastdb

urllib3.disable_warnings()
HERE = os.path.expanduser("~/understudy")
env = dict(l.split("=", 1) for l in open(f"{HERE}/.env").read().splitlines() if "=" in l and not l.startswith("#"))
norm = lambda u: u if u.startswith("http") else "http://" + u  # noqa: E731
CHUNKS = env.get("S3_CHUNKS_BUCKET", "team-39-vss-chunks")
SEGS = env.get("S3_SEGMENTS_BUCKET", "team-39-vss-chunks-segments")
TASKS = {"cups": ("cup-pyramid", "Cup pyramid"), "lego": ("vast-astronaut", "VAST astronaut"), "pour": ("cap-swap", "Cap swap")}
s3 = boto3.client("s3", verify=False, endpoint_url=norm(env["S3_ENDPOINT"]),
                  aws_access_key_id=env["ACCESS_KEY"], aws_secret_access_key=env["SECRET_KEY"])  # fmt: skip


def log(*a):
    print(*a, file=sys.stderr)


def resolve(names):
    found = {n: None for n in names}
    pag = s3.get_paginator("list_objects_v2")
    for page in pag.paginate(Bucket=CHUNKS, Prefix="team-39/20261002"):
        for o in page.get("Contents", []):
            m = s3.head_object(Bucket=CHUNKS, Key=o["Key"]).get("Metadata", {})
            n = m.get("original-filename")
            if n in found and found[n] is None:
                found[n] = {"key": o["Key"], "tags": m.get("tags", "").split(","), "upload_timestamp": m.get("upload-timestamp")}
    return found


def upload(names):
    out = {}
    for n in names:
        kind, q = n[:-4].split("-")
        task, label = TASKS[kind]
        take = 3 if q == "sloppy" else int(q)
        now = datetime.now(timezone.utc)
        key = f"team-39/{now.strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(4)}.mp4"
        tags = ["understudy", f"task:{task}", f"take:{take}", "label:" + label.replace(" ", "_")]
        prompt = (
            f"This video shows a person performing a hands-on task on the floor: {label}. Describe each step of the task "
            "being performed, in order, as short imperative steps."
        )
        meta = {
            "allowed-users": "team-39", "camera-id": "floor-cam1", "capture-type": "general", "custom-prompt": quote(prompt),
            "is-public": "true", "location": "understudy", "original-filename": n, "tags": ",".join(tags),
            "upload-timestamp": now.strftime("%Y-%m-%dT%H:%M:%S.%f"),
        }  # fmt: skip
        s3.upload_file(f"{HERE}/upload_{n}", CHUNKS, key, ExtraArgs={"Metadata": meta, "ContentType": "video/mp4"})
        out[n] = {"key": key, "tags": tags, "upload_timestamp": meta["upload-timestamp"]}
        log("uploaded original", n, "->", key)
    return out


def insert(path):
    rows = json.load(open(path))
    base = os.path.dirname(os.path.abspath(path))
    s = vastdb.connect(endpoint=norm(env.get("VDB_ENDPOINT") or env["S3_ENDPOINT"]), access=env["ACCESS_KEY"],
                       secret=env["SECRET_KEY"], ssl_verify=False)  # fmt: skip
    with s.transaction() as tx:
        t = tx.bucket(env["VASTDB_BUCKET"]).schema(env.get("VDB_SCHEMA", "vss-schema")).table(env.get("VDB_COLLECTION", "vss-collection"))
        schema = pa.schema(t.columns())
        existing = set(t.select(columns=["pk"]).read_all().column("pk").to_pylist())
    new = [r for r in rows if r["pk"] not in existing]
    log(f"{len(rows)} rows, {len(rows) - len(new)} already present, inserting {len(new)}; table had {len(existing)}")
    for r in new:
        key = r["source"].split("/", 3)[3]
        local = os.path.join(base, os.path.relpath(r["_local_seg"], start=r["_local_seg"].split("/ingest/")[0] + "/ingest"))
        try:
            s3.head_object(Bucket=SEGS, Key=key)
        except Exception:
            s3.upload_file(local, SEGS, key, ExtraArgs={"ContentType": "video/mp4"})
    if not new:
        return {"inserted": 0, "before": len(existing)}
    cols = {}
    for f in schema:
        vals = [r.get(f.name) for r in new]
        if f.name == "upload_timestamp":
            vals = [datetime.fromisoformat(v) if isinstance(v, str) else v for v in vals]
        cols[f.name] = pa.array(vals, type=f.type)
    tbl = pa.table(cols, schema=schema)
    with s.transaction() as tx:
        t = tx.bucket(env["VASTDB_BUCKET"]).schema(env.get("VDB_SCHEMA", "vss-schema")).table(env.get("VDB_COLLECTION", "vss-collection"))
        t.insert(tbl)
    with s.transaction() as tx:
        t = tx.bucket(env["VASTDB_BUCKET"]).schema(env.get("VDB_SCHEMA", "vss-schema")).table(env.get("VDB_COLLECTION", "vss-collection"))
        after = t.select(columns=["pk"]).read_all().num_rows
    log(f"inserted {len(new)}; table now {after}")
    return {"inserted": len(new), "before": len(existing), "after": after}


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "resolve":
        print(json.dumps(resolve(args)))
    elif cmd == "upload":
        print(json.dumps(upload(args)))
    elif cmd == "insert":
        print(json.dumps(insert(args[0])))
