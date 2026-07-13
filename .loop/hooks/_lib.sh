#!/usr/bin/env bash
# Shared library for loop hooks. Sourced by preflight.sh, stop.sh, postflight.sh.
# Loads env from ~/.loop-env and per-project .loop/config.env.

# Resolve project root (script lives at .loop/hooks/_lib.sh, root is 2 dirs up)
LOOP_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export LOOP_PROJECT_ROOT

# Load user-level env (secrets: chat id, GH token)
if [[ -f "$HOME/.loop-env" ]]; then
  # shellcheck disable=SC1091
  set -a; . "$HOME/.loop-env"; set +a
fi

# Load per-project config (bot token, repo, project name)
if [[ -f "$LOOP_PROJECT_ROOT/.loop/config.env" ]]; then
  # shellcheck disable=SC1091
  set -a; . "$LOOP_PROJECT_ROOT/.loop/config.env"; set +a
fi

: "${PROJECT_NAME:=$(basename "$LOOP_PROJECT_ROOT")}"

telegram_send() {
  local msg="$1"
  if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
    return 0
  fi
  curl -s --max-time 10 \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=[${PROJECT_NAME}] ${msg}" > /dev/null 2>&1 || true
}

loop_log() { echo "[loop:${PROJECT_NAME}] $*" >&2; }
loop_ts()  { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
loop_has() { command -v "$1" >/dev/null 2>&1; }
