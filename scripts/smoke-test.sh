#!/usr/bin/env bash
# Dispatch smoke test — drive the DEPLOYED stack from the outside.
#
# Every bug found so far came from deploying, not from reading code: the CLI
# silently falling back to a developer's OAuth session, a health probe that
# returned 503 on unencoded brackets, a volume the process could not write to.
# None of them failed a test. All of them failed in production.
#
#   ./scripts/smoke-test.sh
#
# Needs AGENT_API_TOKEN and SOKOSUMI_RUNTIME_KEY in the environment or .env.local.
set -uo pipefail

API="${AGENT_API_PUBLIC_URL:-https://agent-api-production-4ce3.up.railway.app}"
CORE="https://api.preprod.sokosumi.com"
COWORKER="${SOKOSUMI_COWORKER_ID:-01a11058-0fba-71dc-a1b9-acd31d538001}"

[ -f .env.local ] && set -a && . ./.env.local && set +a

pass=0; fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ✅ %-46s %s\n' "$1" "$3"; pass=$((pass+1))
  else printf '  ❌ %-46s expected %s, got %s\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}

echo "── 1. Agent API is reachable ──────────────────────────────"
code=$(curl -s -o /tmp/st-av.json -w '%{http_code}' "$API/availability")
check "GET /availability" 200 "$code"
python3 -c "
import json;d=json.load(open('/tmp/st-av.json'))
print('     status:',d.get('status'))
for r in d.get('reasons',[]): print('     reason:',r)" 2>/dev/null

echo
echo "── 2. Input schema is well-formed ─────────────────────────"
code=$(curl -s -o /tmp/st-is.json -w '%{http_code}' "$API/input_schema")
check "GET /input_schema" 200 "$code"
python3 - <<'PY'
import json
try:
    d=json.load(open('/tmp/st-is.json'))
    # MIP-003: input_data OR input_groups, never both.
    both = 'input_data' in d and 'input_groups' in d
    print('  ', '❌ returns BOTH input_data and input_groups' if both else '✅ exactly one of input_data/input_groups')
    print('     fields:', [f['id'] for f in d.get('input_data',[])])
except Exception as e: print('   ❌ unparseable:', e)
PY

echo
echo "── 3. Operator routes are gated, buyer routes are not ─────"
# /start_job is deliberately open: a marketplace buyer has no pre-shared secret,
# so payment is the gate, not auth. Operator routes must NOT be open.
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/jobs")
check "GET /jobs without token rejected" 401 "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/jobs" -H "authorization: Bearer ${AGENT_API_TOKEN:-none}")
if [ "$code" = "200" ]; then printf '  ✅ %-46s %s\n' "GET /jobs with token allowed" "$code"; pass=$((pass+1))
else printf '  ⚠️  %-46s %s (check AGENT_API_TOKEN)\n' "GET /jobs with token" "$code"; fi

echo
echo "── 4. Malformed input is rejected before any charge ────────"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/start_job" \
  -H "authorization: Bearer ${AGENT_API_TOKEN:-none}" -H 'content-type: application/json' \
  -d '{"identifier_from_purchaser":"not-hex","input_data":{}}')
# 400 = bad nonce. 503 = agent unavailable (also fine: it refused before taking money).
if [ "$code" = "400" ] || [ "$code" = "503" ]; then
  printf '  ✅ %-46s %s\n' "bad purchaser id refused" "$code"; pass=$((pass+1))
else printf '  ❌ %-46s got %s\n' "bad purchaser id refused" "$code"; fail=$((fail+1)); fi

echo
echo "── 5. Unknown job is 404, not invented ────────────────────"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/status?job_id=does-not-exist" \
  -H "authorization: Bearer ${AGENT_API_TOKEN:-none}")
check "GET /status unknown job" 404 "$code"

echo
echo "── 6. The deployed worker is alive and claiming work ───────"
if [ -z "${SOKOSUMI_RUNTIME_KEY:-}" ]; then
  echo "  ⚠️  SOKOSUMI_RUNTIME_KEY not set — skipping"
else
  # Task creation needs a user context the Coworker key does not carry
  # (Core returns "X-Context-User-Id required"), so create through the CLI,
  # which uses the operator's own OAuth session.
  T=$(npx sokosumi --preprod tasks create --personal --coworker-id "$COWORKER" \
    --name "smoke test" \
    --description "Call +16307708220, say this is an automated smoke test, then hang up. You are not authorized to agree to anything." \
    --status READY --json 2>/dev/null \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print((d.get('task') or d).get('id',''))" 2>/dev/null)
  if [ -z "$T" ]; then echo "  ❌ could not create task (run: npx sokosumi --preprod auth login)"; fail=$((fail+1));
  else
    echo "     task $T created, waiting up to 3 min for the worker…"
    got=""
    for i in $(seq 1 18); do
      sleep 10
      S=$(curl -s "$CORE/v1/tasks/$T" -H "Authorization: Bearer $SOKOSUMI_RUNTIME_KEY" \
        | python3 -c "import json,sys;d=json.load(sys.stdin);print((d.get('data') or d).get('status',''))" 2>/dev/null)
      echo "       t+$((i*10))s: $S"
      [ "$S" = "COMPLETED" ] && { got=ok; break; }
      [ "$S" = "FAILED" ] && break
    done
    if [ "$got" = ok ]; then printf '  ✅ %-46s COMPLETED\n' "worker claimed and finished the task"; pass=$((pass+1))
    else printf '  ❌ %-46s see: railway logs --service worker\n' "worker did not complete the task"; fail=$((fail+1)); fi
  fi
fi

echo
echo "────────────────────────────────────────────────────────────"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
