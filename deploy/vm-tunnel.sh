#!/bin/bash
# Cloudflare quick tunnel -> 127.0.0.1:8790. A restart gives a NEW trycloudflare URL (printed below).
[ -f /tmp/understudy-cf.pid ] && kill $(cat /tmp/understudy-cf.pid) 2>/dev/null && sleep 1
setsid nohup ~/cf tunnel --no-autoupdate --url http://127.0.0.1:8790 > /tmp/understudy-cf.log 2>&1 < /dev/null &
echo $! > /tmp/understudy-cf.pid
for i in $(seq 1 30); do u=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /tmp/understudy-cf.log | head -1); [ -n "$u" ] && break; sleep 1; done
echo "tunnel pid $(cat /tmp/understudy-cf.pid)  URL: $u"
