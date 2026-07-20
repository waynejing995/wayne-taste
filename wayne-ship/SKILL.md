---
name: wayne-ship
description: Commit and ship changes following Wayne commit conventions. 1 commit = 1 feature. Jira ticket prefix, signed-off, [why]/[how] format. Runs wayne-code-review as gate before committing. Use when asked to "commit", "ship", "push", "create PR", or "land this".
---

# Wayne Ship

Commit and ship changes with strict commit conventions.
Every commit is atomic (1 feature / 1 fix / 1 request), signed-off, and Jira-tagged.

<HARD-GATE>
BOTH gates MUST pass before any commit. No exceptions.

1. `wayne-code-review` (static) MUST provide a valid PASS artifact for the exact
   current frozen patch hash. If it is absent or stale, invoke it first.
2. `wayne-verify` (runtime) MUST pass: the E2E Verification Contract table must be
   all ✅ — no remaining ⬜ (unverified), no ❌ (broken) — OR the work legitimately
   declared `E2E: none — <reason>` (no user-observable path to verify). If
   the carried verification evidence is absent or stale, invoke it first.
</HARD-GATE>

This skill only specifies the per-feature commit + push + PR workflow.

## Files Written

commit messages, PR descriptions, code comments. Commit prefixes (`SWDEV-1234`, `feat:`, `fix:`), `[why]`/`[how]` headers stay English in Chinese prose.

## Checklist

1. **Pre-flight check** — verify wayne-code-review has passed AND wayne-verify has passed (E2E contract all ✅, or `E2E: none` declared)
2. **Analyze changes** — group by feature/fix, identify Jira tickets
3. **Present commit plan** — show user what will be committed and how
4. **Commit per feature** — one atomic commit per logical change
5. **Push + PR** — if user wants, push and create PR

## Process Flow

```dot
digraph ship {
    rankdir=TB;

    "wayne-code-review\npassed?" [shape=diamond];
    "Run wayne-code-review" [shape=box];
    "wayne-verify passed?\ncontract all ✅?" [shape=diamond];
    "Run wayne-verify" [shape=box];
    "Analyze changes:\ngit status + git diff" [shape=box];
    "Group changes by\nfeature/fix" [shape=box];
    "Identify Jira tickets\nfor each group" [shape=box];
    "Present commit plan\nto user (Chinese)" [shape=box];
    "User approves?" [shape=diamond];
    "Revise grouping" [shape=box];
    "Commit each group\n(1 commit = 1 feature)" [shape=box];
    "Push?" [shape=diamond];
    "Push + create PR" [shape=box];
    "Done" [shape=doublecircle];

    "wayne-code-review\npassed?" -> "Run wayne-code-review" [label="no"];
    "wayne-code-review\npassed?" -> "wayne-verify passed?\ncontract all ✅?" [label="yes"];
    "Run wayne-code-review" -> "wayne-code-review\npassed?";
    "wayne-verify passed?\ncontract all ✅?" -> "Run wayne-verify" [label="no"];
    "wayne-verify passed?\ncontract all ✅?" -> "Analyze changes:\ngit status + git diff" [label="yes"];
    "Run wayne-verify" -> "wayne-verify passed?\ncontract all ✅?";
    "Analyze changes:\ngit status + git diff" -> "Group changes by\nfeature/fix";
    "Group changes by\nfeature/fix" -> "Identify Jira tickets\nfor each group";
    "Identify Jira tickets\nfor each group" -> "Present commit plan\nto user (Chinese)";
    "Present commit plan\nto user (Chinese)" -> "User approves?";
    "User approves?" -> "Commit each group\n(1 commit = 1 feature)" [label="yes"];
    "User approves?" -> "Revise grouping" [label="no"];
    "Revise grouping" -> "Present commit plan\nto user (Chinese)";
    "Commit each group\n(1 commit = 1 feature)" -> "Push?";
    "Push?" -> "Push + create PR" [label="yes"];
    "Push?" -> "Done" [label="no"];
    "Push + create PR" -> "Done";
}
```

---

## Phase 1: Pre-Flight Check

Before any commit work, consume the exact upstream gate artifacts:

1. Validate the code-review manifest, two provider identities, verdict, and frozen
   patch hash against the current diff. Ship does not re-judge review semantics.
2. Validate the exact authoritative matrix path and fresh Verify evidence. Status
   glyphs are structural state; legitimacy of `E2E: none` comes from Verify's AI
   review of the actual requirements, not substring presence.
3. If either artifact is missing, invalid, unavailable, or stale, run its owning
   skill and stop unless the new artifact passes.

Never accept a `PASS`/`PASSED` word in chat or report prose as gate evidence.

---

## Phase 2: Analyze Changes

```bash
git status
git diff --stat
git diff --cached --stat
git log --oneline -5
```

Understand:
- What files changed and why
- Whether changes are staged or unstaged
- Recent commit history for context

---

## Phase 3: Group by Feature

Split changes into atomic groups. Each group = 1 commit.

Rules:
- **1 commit = 1 feature / 1 fix / 1 request.** No bundles.
- Related files go together (e.g., model + migration + test = 1 commit)
- Unrelated changes get separate commits
- If a single change touches many files but serves one purpose, that's still 1 commit

---

## Phase 4: Identify Jira Tickets

For each commit group, find the Jira ticket:

1. Check `TASKS.md` for active tickets related to this work
2. Check the decision log or plan if they reference a ticket
3. Check branch name for ticket prefix (e.g., `SWDEV-1234-feature-name`)
4. If no ticket applies, use `feat:` or `fix:` prefix

---

## Phase 5: Present Commit Plan

Show the user the proposed commits in Chinese:

```
我准备这样提交：

Commit 1: SWDEV-1234 - add user auth middleware
  文件: src/middleware/auth.py, tests/test_auth.py
  [why]: 需要 API 认证
  [how]: JWT middleware + 测试

Commit 2: fix:/dashboard - fix chart rendering on empty data
  文件: dashboard/dashboard.html
  [why]: 空数据时图表崩溃
  [how]: 加了空状态检查

确认吗？还是要调整分组？
```

Wait for user approval. If they want changes, revise grouping.

---

## Phase 6: Commit Per Feature

For each approved group, commit with this exact format:

```bash
git add <specific files for this group>
git commit -s -m "$(cat <<'EOF'
SWDEV-1234 - short descriptive title

[why]
- reason for this change

[how]
- what was done technically

EOF
)"
```

### Commit Message Rules

| Field | Rule |
|-------|------|
| **Line 1** | `<JIRA-TICKET> - short title` (or `feat:/topic` / `fix:/topic` if no ticket) |
| **[why]** | Business/user reason, not technical detail |
| **[how]** | Technical approach, brief |
| **Flag** | Always `git commit -s` (signed-off-by) |
| **Scope** | 1 commit = 1 logical change |

### Examples

```
SWDEV-5678 - add email notification on task completion

[why]
- users miss task status changes when not watching dashboard

[how]
- added SendGrid integration in notification_service.py
- trigger on task transition to "Implemented" or "Closed"
```

```
fix:/sync - handle API timeout in Jira sync

[why]
- sync_jira.py hangs when OnTrack is slow

[how]
- added 30s timeout + retry with backoff
```

---

## Phase 7: Push + PR (Optional)

Only if user explicitly asks to push or create PR.

```bash
git push origin <branch>
```

### Determine the base branch — NEVER hardcode `main`

The PR target (and the branch a fix is cut from / rebased onto) is often a
long-lived integration branch, **not** `main`. Detect it; do not assume.

Resolution order (first hit wins):

1. **User said it** — honor an explicit "target/base `feature/backend-integration`"
   verbatim. This overrides everything below.
2. **This branch's upstream** — `git rev-parse --abbrev-ref --symbolic-full-name @{u}`
   gives `origin/<base>` when the working branch was cut from a remote branch.
3. **Fork point** — the remote branch this one diverged from:
   ```bash
   git log --decorate --oneline --first-parent -20   # eyeball the branch it forked off
   # or the repo's configured default target:
   gh repo view --json defaultBranchRef -q .defaultBranchRef.name
   ```
4. **Only then** fall back to the repo default — and say so out loud so the user
   can correct it.

State the resolved base in the commit plan (Phase 5) and confirm before opening
the PR. When in doubt, ask — a PR opened against the wrong base is a visible,
annoying mistake to unwind.

For PR creation, pass the resolved base explicitly — do not let `gh` default it:
```bash
gh pr create --base "<resolved-base-branch>" \
  --title "<same as commit title>" --body "$(cat <<'EOF'
## Summary
- <bullet points from commit [why] and [how]>

## Review
- wayne-code-review: PASSED
- Sources: one independent Claude voice + one independent Codex voice

## Test Plan
- [ ] <verification items from the plan>
EOF
)"
```

### Cutting / rebasing a fix branch off a non-main base

When the request is "checkout a branch based on remote `<base>` and fix it" or
"rebase to latest remote":

```bash
git fetch origin
git switch -c <fix-branch> origin/<resolved-base>   # cut from the REMOTE tip, not local stale
# … work …
git fetch origin && git rebase origin/<resolved-base>   # rebase onto latest remote before PR
```

Rebase onto the remote base (not a local copy) so the PR is against the current
tip. Cherry-picking a specific PR onto this branch is the same base discipline:
`git cherry-pick <sha>` after confirming the branch is current.

---

## Phase 8: Handoff

As the final step, after the commit (and push/PR, if requested) succeeds, call
**`wayne-checkpoint` in handoff mode** to emit a handoff packet pointing to
`wayne-compound` as the next agent (the pipeline's lessons-capture stage). The
handoff-packet mechanism is defined in `wayne-checkpoint` — this skill only invokes
it; it does not implement or advance it.

**Mode A — return-only.** The packet is returned/surfaced only; it does NOT
auto-invoke `wayne-compound`. The user manually triggers the next step (say "下一步"
/ "继续" / "go").

---

## Integration with Wayne Workflow

```
wayne-mind-explode → wayne-plan → wayne-work → wayne-code-review → wayne-verify → wayne-ship → wayne-compound
     (WHAT)            (HOW)        (BUILD)      (STATIC GATE)      (RUNTIME GATE)  (COMMIT)     (LESSONS)
```

This is the commit step. It only runs after:
1. Implementation is complete (`wayne-work`)
2. Dual-voice review has passed (`wayne-code-review`)
3. Runtime verification has passed (`wayne-verify` — E2E contract all ✅, or `E2E: none` declared)

Its own final step hands off to `wayne-compound` (see Phase 8).

---

## Key Principles

- **1 commit = 1 feature** — never bundle unrelated changes
- **Always signed-off** — `git commit -s`, no exceptions
- **Jira ticket first** — every commit traces to a ticket when possible
- **Both gates before commit** — `wayne-code-review` (static) AND `wayne-verify` (runtime, contract all ✅) are hard gates
- **User approves the plan** — never commit without showing the grouping first
- **Chinese for discussion, English for commits**
