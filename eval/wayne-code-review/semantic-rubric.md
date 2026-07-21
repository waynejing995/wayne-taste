# Blind semantic rubric: Wayne Code Review

Judge one untouched candidate or behavior trial from the request, selected
plan/spec/acceptance sources, frozen diff, candidate skill/playbooks, validated raw
Claude/Codex review JSON, provider manifest, synthesized report, Git start/end
evidence, and checker observations. Do not see candidate identity or the expected
winner.

Decide every applicable `CR01`-`CR19` row in `approved-intent.md`. Confirm routing
uses only relevant review types; planned-missing and diff-unplanned directions are
both covered; dataflow and architecture lenses preserve ownership and applicability;
findings have source-backed severity and exact code evidence; two independent model
families reviewed the same bytes; provider failure cannot become a clean pass; and
synthesis preserves agreement, source-only findings, and unresolved disagreement
without inventing confidence or runtime proof.

Headings, keywords, phrase matches, frontmatter key order, and report wording are
not semantic oracles. Accept equivalent presentation and reject same-shaped reports
that lose evidence, scope, severity, disagreement, mutation safety, or handoff
boundaries. Machine-validated reviewer JSON and payload/adapter evidence are facts,
but the rubric still judges whether they support the review conclusion.

Return JSON only with `verdict: pass | fail | invalid`, per-intent verdicts and
source-grounded evidence, plus blocking/non-blocking findings. Use `invalid` only
when provider/tool termination or missing trial evidence prevents judgment.
