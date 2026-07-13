#!/usr/bin/env bash
# preflight.sh — rate-limit headroom check.
# Exit 0 = OK to proceed. Exit 1 = throttled, skip this run.
# Pass --report to always exit 0 and just print status (used by /limits command).

set -uo pipefail

# shellcheck disable=SC1091
. "$(dirname "$0")/_lib.sh"

MODE="check"
[[ "${1:-}" == "--report" ]] && MODE="report"

THRESHOLD="${LOOP_THRESHOLD_PCT:-15}"

fetch_usage() {
  # --token-limit max derives a limit from the highest historical block total
  # and attaches a tokenLimitStatus{limit,percentUsed,...} field to the active
  # block. Plain `ccusage blocks --json` never includes a limit at all.
  if loop_has ccusage; then
    ccusage blocks --recent --token-limit max --json 2>/dev/null || true
    return
  fi
  if loop_has npx; then
    npx --yes ccusage@latest blocks --recent --token-limit max --json 2>/dev/null || true
    return
  fi
  echo ""
}

RAW="$(fetch_usage)"

if [[ -z "$RAW" ]]; then
  if [[ "$MODE" == "report" ]]; then
    echo "ccusage not installed or unreachable — run 'npm i -g ccusage' to enable."
  fi
  # No data → don't block (better a wasted call than a stuck loop)
  exit 0
fi

# NOTE: RAW is passed via env var, not piped, because `python3 -` reads its
# script from stdin — a piped `| python3 - <<PY` here-doc silently discards
# the piped data (the here-doc wins the stdin redirect), so json.load() would
# always see an empty stream.
PARSED="$(RAW="$RAW" python3 - 2>/dev/null <<'PY' || true
import json, os
try:
    raw = os.environ.get("RAW", "")
    d = json.loads(raw)
    blocks = d.get("blocks", d) if isinstance(d, dict) else d
    active = None
    if isinstance(blocks, list):
        for b in blocks:
            if b.get("isActive"):
                active = b
                break
    if not active:
        print("status=no_active_block")
        raise SystemExit
    status = active.get("tokenLimitStatus") or {}
    total  = status.get("limit") or 0
    used   = active.get("totalTokens") or 0
    ends_at = active.get("endTime") or ""
    if not total:
        print("status=no_limit_data")
        raise SystemExit
    remaining = max(total - used, 0)
    pct = int(round(100 * remaining / total))
    print(f"pct={pct} remaining={remaining} used={used} total={total} resets_at={ends_at}")
except SystemExit:
    raise
except Exception as e:
    print(f"parse_error={e}")
PY
)"

if [[ "$MODE" == "report" ]]; then
  echo "$PARSED"
  exit 0
fi

PCT="$(echo "$PARSED" | sed -n 's/.*pct=\([0-9]*\).*/\1/p')"
if [[ -z "$PCT" ]]; then
  exit 0  # can't parse — proceed rather than get stuck
fi

if (( PCT < THRESHOLD )); then
  loop_log "throttled: headroom ${PCT}% < threshold ${THRESHOLD}%"
  {
    echo ""
    echo "## $(loop_ts) — SKIPPED (rate limit)"
    echo "Headroom ${PCT}% below threshold ${THRESHOLD}%. Next scheduled run will retry."
  } >> "$LOOP_PROJECT_ROOT/.loop/progress.md"
  telegram_send "Skipping run — rate-limit headroom at ${PCT}%."
  exit 1
fi

loop_log "preflight OK (headroom ${PCT}%)"
exit 0
