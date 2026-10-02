#!/bin/bash
# Start Understudy for the demo: API server on :8787, web app on :5190.
# The live coach only needs Cosmos (public IP) and W&B; the VM tunnel is optional (library rebuilds only).
set -e
cd "$(dirname "$0")"
[ -f .env.local ] || { echo "missing .env.local (team credentials)"; exit 1; }

lsof -ti tcp:8787 | xargs kill 2>/dev/null || true
lsof -ti tcp:5190 | xargs kill 2>/dev/null || true

(cd server && nohup uv run uvicorn app:app --port 8787 > /tmp/understudy-server.log 2>&1 < /dev/null &)
(cd web && nohup bun run dev --port 5190 --strictPort > /tmp/understudy-web.log 2>&1 < /dev/null &)

for i in $(seq 1 40); do curl -s -m 2 -o /dev/null localhost:8787/api/health && break; sleep 0.5; done
for i in $(seq 1 40); do curl -s -m 2 -o /dev/null localhost:5190 && break; sleep 0.5; done

curl -s -m 8 localhost:8787/api/health | python3 -c "
import sys, json
h = json.load(sys.stdin)
for k in ('cosmos_reason', 'cosmos_embed', 'wandb', 'vss'):
    v = h.get(k, {})
    print(f\"  {k:14s} {'ok' if v.get('ok') else 'DOWN'}  {v.get('ms', '')} ms\")
"
echo
echo "Open http://localhost:5190  (1 Library · 2 Map · 3 Coach · 4 Score · Space next · R reset · T force Cap swap)"
echo "Logs: /tmp/understudy-server.log /tmp/understudy-web.log"
