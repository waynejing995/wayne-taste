# Blind semantic rubric: Wayne Code Review

Judge one untouched behavior trial or skill candidate from the request, the frozen
case fixture (`AGENTS.md`, `case.md`, the working-tree diff), the supplied skill
directory including `references/reviewer-protocol.md`, the user-visible review output,
the Git start/end evidence (`repo-start-status.txt`, `repo-start-diff.sha256`, and the
repository's current status, tracked diff, index, and commit count), and the checker
observations. Do not see candidate identity or the expected winner.

Decide every applicable `CR01`-`CR23` row in `approved-intent.md`, skipping rows whose
status is `WORKFLOW`, `SUPERSEDED`, or `UNCOVERED` — those are not this skill's
obligations. Confirm that: the review covers the diff in both directions against any
stated intent; the dataflow and architecture lenses preserve ownership and
applicability; findings carry severity, confidence, and exact file/line evidence;
both dispatched voices are attributed, or a missing voice is explicitly labelled as a
single-voice run rather than presented as dual-voice; synthesis preserves agreement,
source-only findings, and unresolved disagreement without inventing confidence or
runtime proof; judgment calls are put to the user rather than resolved unilaterally;
and no commit, push, or downstream-skill invocation occurred.

Headings, keywords, phrase matches, frontmatter key order, and report wording are
not semantic oracles. Accept equivalent presentation and reject same-shaped reports
that lose evidence, scope, severity, disagreement, mutation safety, or handoff
boundaries. The Git before/after evidence is fact; the rubric still judges whether
the review's own claims are supported by the diff it read.

Return JSON only with `verdict: pass | fail | invalid`, per-intent verdicts and
source-grounded evidence, plus blocking/non-blocking findings. Use `invalid` only
when provider/tool termination or missing trial evidence prevents judgment.
