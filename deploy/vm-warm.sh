#!/bin/bash
# Keep the demo search queries in the server cache (30 min TTL) so Map search answers instantly.
for q in "person swapping bottle caps" "forklift near a person" "someone stacking cups" "people crossing the street" "truck changing lanes"; do
  curl -s -m 60 -o /dev/null -X POST http://127.0.0.1:8790/api/search -H "content-type: application/json" -d "{\"query\":\"$q\",\"top_k\":8}"
done
