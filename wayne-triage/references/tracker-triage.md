# Tracker Triage — GitHub issue / external PR / Jira ticket

The tracker surface of wayne-triage. A tracker item is a failure report with
metadata: it needs the same spine (evidence SSoT → verify → root-cause enough to
route → human-gate route), plus category/state classification and a durable
handoff brief. **A PR is an issue with attached code** — same states, verify
against the diff.

Adapted from mattpocock/skills `triage` (MIT). Wayne deltas: data is fetched
user-driven (never guessed); findings land in the `.wayne/triage/` evidence file;
routing maps to Wayne pipeline stages; and — the key Wayne difference —
**triage only COMMENTS, it never mutates the tracker.**

## Triage comments, it does not mutate the tracker

Triage is a decision layer, not the tracker's write layer. It MUST NOT add/remove
labels, change status/state, assign, or close/transition an item — those touch
shared board state that others read, and per Wayne blast-radius discipline are
authorized, human-driven actions, not something triage does as a side effect.

- Triage's tracker output is a **comment** that states the recommendation (category, suggested route, reasoning, brief).
- The actual label/state/transition change is left to a human, or on Jira to the wayne `cvs-jira-workflow` skill.
- The category + state names below are triage's internal routing vocabulary, expressed in the comment as a recommendation — NOT labels triage writes back.

## Getting the item (user-driven, never guessed)

Triage does NOT decide where the data lives or auto-call an API. Per Phase 0:

- Item text already pasted / quoted → use it.
- User gave the fetch method → run exactly that: `gh issue view 42`, `gh pr view 88 --json ...`, or for Jira the **wayne `cvs-jira-workflow`** skill / the fetch command the user named.
- Neither → ask "how should I pull it?" Then follow the answer.

Triage reads the fetched item; it never owns the fetch or the eventual write-back
transition (Jira transitions → `cvs-jira-workflow`).

## Category + state (classification — recommended in a comment, not written back)

Two category roles: `bug` (something broken) · `enhancement` (new feature/change).

Five state roles — triage's internal routing vocabulary. Recommend exactly one in
the comment; do NOT apply it as a label.

| State (recommendation) | Meaning | Maps toward |
|---|---|---|
| `needs-triage` | not yet evaluated | keep triaging |
| `needs-info` | waiting on reporter (repro/detail insufficient) | out of pipeline — comment the questions, await |
| `ready-for-agent` | fully specified, an AFK agent can take it | Wayne pipeline (see route table in SKILL.md) |
| `ready-for-human` | needs human judgment / access / manual test | route-to-owner |
| `wontfix` | should not be actioned | recommend close (human/`cvs-jira-workflow` does it) |

Recommend exactly one category + one state. Conflicting signals → flag it in the
comment and ask the maintainer; do not decide it silently.

## Tracker intake steps

1. **Gather context.** Read the full item (body, comments, labels, author, dates; PR → the diff too). Parse prior triage notes so you don't re-ask resolved questions.
2. **Seen-before / redundancy (concept, not keyword).**
   - Search the codebase for an existing implementation of the requested behavior **by domain concept**, not the request's wording. Report where you looked. Found → it's an already-implemented `wontfix` (point to where it lives; do NOT record as a rejection).
   - Check prior rejections: read the repo's `.out-of-scope/*.md` (if the repo keeps one) and any prior `.wayne/triage/` entry that matches by concept. A match → surface it: "we rejected/handled this before because <reason> — still holds?"
3. **Recommend.** State your category + state recommendation with reasoning and a short codebase summary (including whether it's already implemented). Wait for direction.
4. **Verify the claim (before any deep work).** Bug → reproduce from the reporter's steps. PR → check out the diff, run the relevant tests/commands. Report: confirmed (with code path), failed, or insufficient detail. **Insufficient repro = strong `needs-info`** — a confirmed repro is the entry ticket to any fix route (the Bug gate in SKILL.md Phase 5).
5. **Grill if under-specified.** If the request needs shape, sharpen it one question at a time (use wayne-mind-explode's grill mode); capture resolved points so they aren't lost.
6. **Record the outcome** — write findings to the `.wayne/triage/` evidence file, then post ONE comment stating the recommendation. Never change labels/state/assignee yourself; recommend, and let a human or `cvs-jira-workflow` apply it.
   - `ready-for-agent` / `ready-for-human` → comment the durable brief (see below) + the recommended route per SKILL.md Phase 5 table.
   - `needs-info` → comment triage notes: what's established, what's still needed (specific, actionable questions).
   - `wontfix` (recommend, don't close):
     - **already implemented** — comment where it lives; do not record as a rejection.
     - **rejected (bug)** — comment a polite explanation + recommend close.
     - **rejected (enhancement)** — comment the concept + reason + prior requests (note the repo `.out-of-scope/` entry if it keeps one) + recommend close.

## Verify → repro is the fix-route gate

The Bug gate (SKILL.md Phase 5) applies to the tracker surface verbatim: a bug
cannot route toward a fix without a repro / failing test. On the tracker surface,
a failed or insufficient repro is not a dead end — it's the `needs-info` route,
with specific questions back to the reporter.

## Durable handoff brief (for ready-for-agent / ready-for-human)

The brief is the contract the next stage works from — it may sit for days while
the codebase moves. Write it durable:

- **Behavioral, not procedural** — what the system should do, not how to code it.
- **Interfaces / contracts, NEVER file:line** — name types, signatures, config shapes; paths and line numbers go stale.
- **Complete, testable acceptance criteria** — each independently verifiable.
- **Explicit out-of-scope** — what NOT to touch, so the next stage doesn't gold-plate.

Use `templates/triage-report.md` for the brief body. For a Wayne-pipeline route,
this brief becomes the "next prompt" payload of the `wayne-checkpoint handoff`
packet (SKILL.md Phase 5).

## `needs-info` template

```markdown
## Triage Notes
> *Generated by AI during triage.*

**Established so far:**
- <point>

**Still needed from you (@reporter):**
- <specific, actionable question — not "please provide more info">
```

## Enhancement vs bug — different downstream

- **bug** → repro/failing test required → `test-then-fix` / `iterate-in-a-loop` / `needs-plan` per blast radius.
- **enhancement** → no repro test (nothing's broken); acceptance criteria come from grilling → `needs-plan` → wayne-test-design → wayne-plan → wayne-work (normal TDD, not a reproduction test).
