#!/usr/bin/env bash
# One-time installer: wires the loop scaffold into .claude/.
# - Registers the Stop hook in .claude/settings.json (merging, not overwriting)
# - Copies slash commands from .loop/commands/ to .claude/commands/
# - Makes hook scripts executable
# Idempotent — safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Making hooks executable..."
chmod +x .loop/hooks/*.sh

echo "==> Copying slash commands to .claude/commands/..."
mkdir -p .claude/commands
cp -v .loop/commands/*.md .claude/commands/

echo "==> Merging Stop hook into .claude/settings.json..."
SETTINGS=".claude/settings.json"
mkdir -p .claude
if [[ ! -f "$SETTINGS" ]]; then
  echo '{}' > "$SETTINGS"
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to merge settings.json safely. Install it:" >&2
  echo "  brew install jq" >&2
  exit 1
fi

TMP=$(mktemp)
jq '
  .hooks = (.hooks // {}) |
  .hooks.Stop = (.hooks.Stop // []) |
  (.hooks.Stop | map(select(.matcher == "loop-stop"))) as $existing |
  if ($existing | length) == 0 then
    .hooks.Stop += [{
      "matcher": "loop-stop",
      "hooks": [{
        "type": "command",
        "command": ".loop/hooks/stop.sh"
      }]
    }]
  else . end
' "$SETTINGS" > "$TMP"

mv "$TMP" "$SETTINGS"
echo "Updated $SETTINGS"

echo ""
echo "==> Ensuring .gitignore excludes loop scratch files..."
GI=".gitignore"
touch "$GI"
for pat in ".loop/progress.md" ".loop/questions.md" ".loop/.block_count" ".loop/.questions_hash" ".loop/config.env"; do
  if ! grep -qxF "$pat" "$GI"; then
    echo "$pat" >> "$GI"
    echo "  + $pat"
  fi
done

echo ""
echo "==> Checking ~/.loop-env..."
if [[ ! -f "$HOME/.loop-env" ]]; then
  echo "  NOT FOUND. Create it with:"
  echo "    cat > ~/.loop-env <<EOF"
  echo "    TELEGRAM_CHAT_ID=8902013701"
  echo "    GH_TOKEN=<your github PAT>"
  echo "    EOF"
  echo "    chmod 600 ~/.loop-env"
else
  echo "  OK: ~/.loop-env exists"
fi

echo ""
echo "==> Done. Try: claude \"/limits\"  then  claude \"/loop-next\""
