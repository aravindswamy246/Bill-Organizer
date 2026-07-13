---
description: Run one loop iteration — pick the next unblocked task and work on it.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
---

## Preflight

!bash .loop/hooks/preflight.sh

If preflight exited non-zero (rate-limited), stop here — do NOT try to work. Report "skipped: rate-limited" and end.

## Read state

Read `.loop/progress.md` and `.loop/questions.md` in this project. Understand:
- What was done in previous iterations
- What's currently in flight
- What questions are still open (blocking specific tasks)

## Read the project

Skim these to know what you're building:
- `README.md`, `CLAUDE.md`, `prompt.md` (if present)
- `docs/` folder, `architecture/` folder (if present)

## Pick the next task

Priorities:
1. Something that unblocks other work (foundation, shared utility, migration).
2. Something whose blockers are NOT in `.loop/questions.md` (skip anything waiting on the user).
3. Prefer smaller, well-scoped tasks over sprawling ones — one iteration ≈ 30–60 min of focused work.

If you're genuinely stuck (every promising task is blocked by open questions), pick the smallest useful piece of independent scaffolding — tests for existing code, doc updates, refactoring — rather than waiting.

## Model routing (use Task tool subagents)

- **Haiku** — file scaffolding, renames, lint fixes, boilerplate. Cheap and fast.
- **Sonnet** (default) — feature work, straightforward debugging.
- **Opus** — architectural decisions, hard debugging, security-sensitive changes.

Spawn subagents via the Task tool with `model` set explicitly when the task type is unambiguous. Do the bulk of coordination yourself.

## Do the work

Actually implement the task. Follow the project's `CLAUDE.md` conventions strictly.

## When blocked, ask — don't guess

If you hit a decision that needs the user's input (product decision, unclear requirement, choice between two valid approaches), append to `.loop/questions.md`:

```markdown
- [ ] YYYY-MM-DD HH:MM — Short question here.
  Context: what you were doing when this came up.
  Options considered: A, B, C.
  Recommendation: X (why).
```

Then move to another independent task. Do NOT block the whole run on one question.

## Update progress

Before you stop, append to `.loop/progress.md`:

```markdown
## YYYY-MM-DD HH:MM — <task name>
- Did: <one-line summary>
- Files: <changed files>
- Next: <what should happen next iteration>
- Blockers: <any new open questions>
```

## Postflight

!bash .loop/hooks/postflight.sh

The Stop hook will now run. If tests/lint/typecheck fail, it'll refuse to let you stop and you'll get feedback to fix. Fix and try to stop again.
