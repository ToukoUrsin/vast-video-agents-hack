# Public demo deploy

**Live link:** https://hints-modules-jvc-suspension.trycloudflare.com

All four screens work there: Library, Map (with live "Ask the archive" search), Coach (webcam, HTTPS)
and Score. Open `?screen=3` to land on the Coach.

## How it runs

- Host: team VAST VM (`ssh vastvm`, `bc-pool-077`), inside the VAST network, so VSS search works.
- `~/understudy-app/` on the VM: `server/` (FastAPI, own uv venv), `web/dist` (production build),
  `web/public`, `web/src/data` (archive snapshot), `.env.local` (credentials, VM only).
- uvicorn on `127.0.0.1:8790` with `UNDERSTUDY_PUBLIC=1 VSS_SOCKS_PROXY=none`: serves the built web
  app and `/api` from one origin. Log: `/tmp/understudy-public.log`.
- Cloudflare quick tunnel (`~/cf tunnel --url http://127.0.0.1:8790`) gives the HTTPS URL. Log:
  `/tmp/understudy-cf.log`. Separate from the existing `cf tunnel --url ssh://localhost:22` process.
- `@reboot` crontab entry restarts both (the URL changes after a reboot).
- `*/10` crontab entry runs `~/understudy-app/warm.sh`: re-queries the 5 demo searches against
  localhost so they stay in the server's 30 min search cache (VSS search takes ~20 s under load).

## Restart

```bash
ssh vastvm '~/understudy-app/run.sh'      # server only; URL stays the same
ssh vastvm '~/understudy-app/tunnel.sh'   # tunnel; prints a NEW trycloudflare URL
```

Ship code changes from a checkout (needs `.env.local` there):

```bash
(cd web && bun run build)
rsync -az --exclude node_modules --exclude .venv --exclude __pycache__ -R \
  server web/dist web/public web/src/data .env.local vastvm:understudy-app/
ssh vastvm 'cd understudy-app/server && ~/.local/bin/uv sync && ~/understudy-app/run.sh'
```

Copies of the VM scripts: `deploy/vm-run.sh`, `deploy/vm-tunnel.sh`, `deploy/vm-warm.sh`.

## Abuse guard

No key in the URL, so the judge link stays one click. With `UNDERSTUDY_PUBLIC=1` the server
rate-limits per client IP (Cloudflare `CF-Connecting-IP`), sliding window per minute:

| Route | Limit |
|---|---|
| `/api/check-step` | 90/min (a live coach run does about 40-50/min) |
| `/api/identify` | 20/min |
| `/api/feedback` | 10/min |
| `/api/search` | 20/min |
| `/api/search/thumb` | 120/min |
| `/api/expert-clip` | 30/min |
| `/api/health` | 10/min |

Plus a global cap of 6000 limited calls per hour (`UNDERSTUDY_GLOBAL_PER_HOUR`). Over the limit:
HTTP 429. Credentials stay in `.env.local` on the VM; the browser only talks to `/api`.

## Fragility

- Quick tunnels have no uptime guarantee, and any tunnel restart or VM reboot changes the URL.
- The VM may be torn down after the event; then the link dies.
- Cosmos endpoints (166.19.38.112) and W&B are shared event infrastructure.
