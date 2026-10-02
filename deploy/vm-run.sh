#!/bin/bash
# Understudy public deploy: API + built web on 127.0.0.1:8790 (restart this to pick up code changes).
cd ~/understudy-app/server
[ -f /tmp/understudy-public.pid ] && kill $(cat /tmp/understudy-public.pid) 2>/dev/null && sleep 1
UNDERSTUDY_PUBLIC=1 VSS_SOCKS_PROXY=none setsid nohup ~/.local/bin/uv run uvicorn app:app --host 127.0.0.1 --port 8790 > /tmp/understudy-public.log 2>&1 < /dev/null &
echo $! > /tmp/understudy-public.pid
echo "uvicorn pid $(cat /tmp/understudy-public.pid)"
