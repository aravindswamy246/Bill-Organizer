#!/usr/bin/env bash
# postflight.sh — end-of-run housekeeping.
# Called from /loop-next after work is done.
# - Commits changes to a scratch branch loop/YYYY-MM-DD-HH
# - Pushes and opens/updates a draft PR
# - Sends Telegram summary if questions.md changed

set -uo pipefail

# shellcheck disable=SC1091
. "$(dirname "$0")/_lib.sh"

cd "$LOOP_PROJECT_ROOT"

BRANCH="loop/$(date -u +%Y-%m-%d-%H)"
DEFAULT_BRANCH="${LOOP_BASE_BRANCH:-main}"
export BRANCH DEFAULT_BRANCH

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  loop_log "not a git repo — skipping git steps"
  exit 0
fi

# ---- Commit ----
if [[ -z "$(git status --porcelain)" ]]; then
  loop_log "no changes to commit"
else
  git checkout -B "$BRANCH" >/dev/null 2>&1
  git add -A
  git -c user.email="loop@local" -c user.name="Loop Bot" \
    commit -m "loop: $(loop_ts) automated iteration" >/dev/null 2>&1 \
    && loop_log "committed to $BRANCH" \
    || loop_log "commit failed"
fi

# ---- Push + PR ----
if [[ -z "${GH_TOKEN:-}" ]]; then
  loop_log "GH_TOKEN not set — skipping push/PR"
elif [[ -z "${GH_REPO:-}" ]]; then
  loop_log "GH_REPO not set — skipping push/PR"
else
  ORIGIN_URL="$(git config --get remote.origin.url 2>/dev/null || echo "")"
  if [[ "$ORIGIN_URL" == https://* ]]; then
    PUSH_URL="https://x-access-token:${GH_TOKEN}@${ORIGIN_URL#https://}"
    git push "$PUSH_URL" "$BRANCH" >/dev/null 2>&1 \
      && loop_log "pushed $BRANCH" \
      || loop_log "push failed"
  else
    git push origin "$BRANCH" >/dev/null 2>&1 \
      && loop_log "pushed $BRANCH" \
      || loop_log "push failed (non-https origin — need SSH setup)"
  fi

  OWNER="${GH_REPO%/*}"
  EXISTING="$(curl -s \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GH_REPO}/pulls?head=${OWNER}:${BRANCH}&state=open" \
    | python3 -c "import json,sys
try:
  d=json.load(sys.stdin); print(d[0]['number'] if d else '')
except: print('')" 2>/dev/null)"

  if [[ -z "$EXISTING" ]]; then
    BODY="$(python3 -c "
import json, os
print(json.dumps({
  'title': f'loop: {os.environ[\"BRANCH\"]} iteration',
  'head':  os.environ['BRANCH'],
  'base':  os.environ['DEFAULT_BRANCH'],
  'body':  'Automated loop iteration. See .loop/progress.md for changes and .loop/questions.md for pending questions.',
  'draft': True
}))")"
    curl -s -X POST \
      -H "Authorization: Bearer $GH_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${GH_REPO}/pulls" \
      -d "$BODY" > /tmp/loop-pr-$$.json 2>&1
    if grep -q '"number"' /tmp/loop-pr-$$.json; then
      loop_log "PR opened"
    else
      loop_log "PR open failed — see /tmp/loop-pr-$$.json"
    fi
  else
    loop_log "PR #${EXISTING} already open — pushed new commit"
  fi
fi

# ---- Notify on questions.md change ----
QUESTIONS="$LOOP_PROJECT_ROOT/.loop/questions.md"
LAST_HASH_FILE="$LOOP_PROJECT_ROOT/.loop/.questions_hash"
if [[ -f "$QUESTIONS" ]]; then
  CUR_HASH="$(sha256sum "$QUESTIONS" 2>/dev/null | awk '{print $1}')"
  PREV_HASH="$(cat "$LAST_HASH_FILE" 2>/dev/null || echo "")"
  if [[ "$CUR_HASH" != "$PREV_HASH" ]]; then
    OPEN_COUNT="$(grep -c '^- \[ \]' "$QUESTIONS" 2>/dev/null || echo 0)"
    if (( OPEN_COUNT > 0 )); then
      telegram_send "Iteration done. ${OPEN_COUNT} open question(s) waiting — check .loop/questions.md"
    else
      telegram_send "Iteration done. No open questions."
    fi
    echo "$CUR_HASH" > "$LAST_HASH_FILE"
  fi
fi

loop_log "postflight complete"
