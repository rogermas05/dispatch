#!/usr/bin/env bash
# Keep an eye on the endpoint Sokosumi uses to decide whether we stay listed.
#
# The listing is withdrawn automatically when /availability stops being
# reachable, so an outage costs the marketplace entry as well as the uptime —
# and nothing tells us it happened. Prints a line only when the state changes.
#
#   ./scripts/watch-availability.sh            # every 60s
#   ./scripts/watch-availability.sh 30         # every 30s
set -uo pipefail
URL="${AGENT_API_PUBLIC_URL:-https://agent-api-production-4ce3.up.railway.app}/availability"
INTERVAL="${1:-60}"
last=""
echo "watching $URL every ${INTERVAL}s — only changes are printed"
while true; do
  body=$(curl -s --max-time 10 "$URL" 2>/dev/null)
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null)
  status=$(printf '%s' "$body" | python3 -c "import json,sys;print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "unparseable")
  state="$code/$status"
  if [ "$state" != "$last" ]; then
    ts=$(date '+%H:%M:%S')
    if [ "$code" = "200" ] && [ "$status" = "available" ]; then
      echo "$ts  ✅ available"
    else
      echo "$ts  ⚠️  $code $status  — Sokosumi may delist. $(printf '%s' "$body" | head -c 160)"
    fi
    last="$state"
  fi
  sleep "$INTERVAL"
done
