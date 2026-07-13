# .loop — Loop Engineering scaffold

Automates iterative development via scheduled Claude Code sessions with rules-based verification.

## Files

- **`hooks/stop.sh`** — Stop hook. Refuses to let the model finish while `typecheck`/`lint`/`test` fail. Exit code 2 feeds an error message back to the model so it keeps working.
- **`hooks/preflight.sh`** — Rate-limit check. Reads `ccusage` and aborts the run cheaply if headroom is below threshold. Also powers `/limits`.
- **`hooks/postflight.sh`** — Commits to `loop/<date-hour>` branch, pushes, opens/updates a draft PR, pings Telegram if questions.md changed.
- **`commands/limits.md`** — `/limits` slash command (copied to `.claude/commands/` by `install.sh`).
- **`commands/loop-next.md`** — `/loop-next` slash command; one loop iteration end-to-end.
- **`config.env`** — Project-specific env (gitignored).
- **`progress.md`** — Checkpoint log the loop reads at run start and appends to at run end. Gitignored.
- **`questions.md`** — Pending questions for the human. Gitignored.

## Setup

One-time per project:

```bash
bash .loop/install.sh
```

That symlinks/copies the Stop hook + slash commands into `.claude/`.

You also need `~/.loop-env`:

```bash
cat > ~/.loop-env <<'EOF'
TELEGRAM_CHAT_ID=<your telegram user id>
GH_TOKEN=<your github fine-grained PAT>
EOF
chmod 600 ~/.loop-env
```

## Manual iteration (dry-run)

```bash
claude "/loop-next"
```

## Reference

Inspired by [Siddhant-Goswami/100x-loops](https://github.com/Siddhant-Goswami/100x-loops).
