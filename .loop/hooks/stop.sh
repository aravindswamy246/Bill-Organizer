#!/usr/bin/env bash
# Claude Code Stop hook.
# Exit 2 = "keep working" (message on stderr is fed back to the model).
# Exit 0 = allow stop.
#
# Verification order: package.json exists → typecheck → lint → tests.
# After MAX_BLOCKS blocks in one session, allow stop to prevent infinite loop.

set -uo pipefail

# shellcheck disable=SC1091
. "$(dirname "$0")/_lib.sh"

# Consume Claude Code's JSON payload from stdin
cat > /dev/null 2>&1 || true

BLOCK_FILE="$LOOP_PROJECT_ROOT/.loop/.block_count"
MAX_BLOCKS="${LOOP_MAX_BLOCKS:-5}"
BLOCK_COUNT=0
[[ -f "$BLOCK_FILE" ]] && BLOCK_COUNT=$(cat "$BLOCK_FILE" 2>/dev/null || echo 0)

if (( BLOCK_COUNT >= MAX_BLOCKS )); then
  loop_log "max blocks (${MAX_BLOCKS}) reached — allowing stop"
  rm -f "$BLOCK_FILE"
  exit 0
fi

cd "$LOOP_PROJECT_ROOT"

FAILURES=()

run_check() {
  local name="$1"; shift
  local log="/tmp/loop-${name}-$$.log"
  if "$@" > "$log" 2>&1; then
    loop_log "PASS: $name"
  else
    local tail_out
    tail_out=$(tail -n 5 "$log" | tr '\n' '|' | sed 's/|/ | /g')
    FAILURES+=("$name — $tail_out")
  fi
}

if [[ ! -f package.json ]]; then
  FAILURES+=("package.json missing — bootstrap the Expo project from PRD.md / README.md before finishing.")
elif ! loop_has npm; then
  loop_log "npm not available — skipping verification"
  rm -f "$BLOCK_FILE"
  exit 0
else
  has_script() {
    node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts['$1']?0:1)" 2>/dev/null
  }
  has_script typecheck && run_check typecheck npm run typecheck
  has_script lint      && run_check lint      npm run lint
  has_script test      && run_check test      npm test -- --passWithNoTests --ci
fi

if (( ${#FAILURES[@]} == 0 )); then
  loop_log "all checks passed — allowing stop"
  rm -f "$BLOCK_FILE"
  exit 0
fi

BLOCK_COUNT=$((BLOCK_COUNT + 1))
echo "$BLOCK_COUNT" > "$BLOCK_FILE"

{
  echo "[block ${BLOCK_COUNT}/${MAX_BLOCKS}] Verification failed. Fix and try again:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  echo ""
  echo "Full logs at /tmp/loop-*.log. Do NOT try to bypass this hook — fix the root cause."
} >&2

exit 2
