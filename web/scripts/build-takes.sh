#!/usr/bin/env bash
# Transcode our recorded takes (recordings/*.mp4) for the web app:
#   public/takes/<task>-<n>.mp4   720p H.264, faststart, ~2 Mbps, no audio
#   public/takes/<task>-<n>.jpg   poster frame
#   public/takes/<task>-step<k>.jpg  still from take 1 at the middle of each step's expert window
# Step windows live in src/data/placeholder.ts (TASKS) and are mirrored here.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=../recordings
OUT=public/takes
mkdir -p "$OUT"

task_of() { case $1 in pour) echo cap-swap ;; cups) echo cup-pyramid ;; lego) echo vast-astronaut ;; esac; }
poster_at() { case $1 in pour) echo 0.62 ;; cups) echo 0.55 ;; lego) echo 0.85 ;; esac; }

for p in pour cups lego; do
  t=$(task_of $p)
  for n in 1 2 sloppy; do
    k=$n; [ "$n" = sloppy ] && k=3
    in="$SRC/$p-$n.mp4"; mp4="$OUT/$t-$k.mp4"
    if [ ! -f "$mp4" ] || [ "$in" -nt "$mp4" ]; then
      ffmpeg -loglevel error -y -i "$in" -an -vf "scale=-2:720,format=yuv420p" \
        -c:v libx264 -preset slow -profile:v high -b:v 2M -maxrate 2.5M -bufsize 4M \
        -movflags +faststart "$mp4"
    fi
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mp4")
    f=$(poster_at $p); [ "$p-$n" = lego-sloppy ] && f=0.6
    at=$(python3 -c "print(round($dur*$f,2))")
    ffmpeg -loglevel error -y -ss "$at" -i "$mp4" -frames:v 1 -vf scale=640:-2 -q:v 3 "$OUT/$t-$k.jpg"
  done
done

# per-step stills from take 1 (window midpoints, seconds)
still() { ffmpeg -loglevel error -y -ss "$3" -i "$OUT/$1-1.mp4" -frames:v 1 -vf scale=640:-2 -q:v 3 "$OUT/$1-step$2.jpg"; }
still cap-swap 1 3;   still cap-swap 2 17.5; still cap-swap 3 23.5; still cap-swap 4 34.5; still cap-swap 5 36.5
still cup-pyramid 1 4.5; still cup-pyramid 2 9; still cup-pyramid 3 16.5; still cup-pyramid 4 20.5
still vast-astronaut 1 2; still vast-astronaut 2 5.5; still vast-astronaut 3 9.5; still vast-astronaut 4 13.5; still vast-astronaut 5 17
ls -la "$OUT" | awk '{print $5, $9}'
