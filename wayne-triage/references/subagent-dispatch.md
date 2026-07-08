# Subagent Dispatch — prompt templates + output contracts

The context-discipline HARD-GATE says the main agent must not read big logs
itself. That only holds if dispatching is *cheaper than reading it yourself* — so
this file gives copy-paste prompts and the exact output shape to expect back.
Lower the friction and the dispatch actually happens.

Two dispatch shapes: **boundary-scout** (Phase 3, one per component boundary) and
**hypothesis-tester** (Phase 4, one per hypothesis). Both run in parallel — send
all of them in ONE message.

## Fan-out: how many, and parallel vs serial

Dispatch as many subagents as the work has independent pieces — often more than
one per phase. The rule: **independent work fans out in parallel (N subagents in
ONE message); only genuine input-dependencies go serial.**

| Fan-out pattern | When | Parallel? |
|---|---|---|
| by boundary | multi-component failure — one scout per layer boundary | ✅ one message, N scouts |
| by hypothesis | matrix has ≥2 candidate causes — one tester each | ✅ one message, N testers |
| by angle | ONE hypothesis has several independent checks (e.g. a flaky test: async-wait AND concurrency AND test-order testers at once) | ✅ one message, N testers |
| by log-segment | a single huge log — slice by time window / component, one scout per slice, merge on return | ✅ one message, N scouts |
| serial (the exception) | a step's input depends on a prior subagent's output (e.g. find the BREAK-HERE layer first, THEN deep-dive only that layer) | ❌ wait for the dependency, then dispatch |

Decide with one question: *does subagent B need subagent A's result to start?* No →
same message, parallel. Yes → serial. Never serialize independent work "to be
safe" — that wastes the fast subagents' idle time and defeats the whole point of
keeping the log off the main context.

Merging a parallel batch: all subagents append to the same evidence file (SSoT);
the main agent reads the merged file, not the individual transcripts.

## The three hard contracts (every dispatch)

1. **Subagents gather evidence; the MAIN agent decides the route.** A subagent returns an evidence-level verdict about its ONE piece (`ELIMINATED/SURVIVES`, `PASS/BREAK-HERE`) — it MUST NOT emit a route verdict (`fix-now`, `needs-plan`, …) or an attribution. Routing and attribution are the main agent's exclusive job: it alone sees the whole matrix and applies the Phase-5 hard gates. Reason (from autoresearch-x): the agent that gathers evidence must not judge where it goes — that splits the decision across contexts and invites confirmation bias.
2. **Return ONLY the structured fields below — never raw log excerpts, never narrative.** The main agent's context must not absorb the log the subagent read.
3. **Write findings into the evidence file, and also return them.** The evidence file (`<cwd>/.triage/<date>-<slug>.md`) is the SSoT; the returned fields are the summary the main agent acts on. State flows through the file, not the prompt chain.

Every returned claim carries an evidence marker: `[OBSERVED]` (verbatim in a
log/artifact, cite `file:line`) / `[INFERRED]` / `[UNCERTAIN]`.

---

## Boundary-scout (Phase 3)

Dispatch one per component boundary when the log is heavy or there are ≥2
boundaries. Each scout reads ONE layer's slice and reports whether data crossed it
intact.

### Prompt template

```
You are a boundary-scout for a triage. Investigate ONE component boundary and
report whether data crosses it intact. Do NOT propose fixes. Do NOT return raw
log text — return only the structured fields specified.

Evidence file (SSoT, append your findings here): <path>
Boundary to inspect: <layerA> → <layerB>
Log/artifact to read: <path or command>   (read ONLY what this boundary needs)
What "good" looks like at this boundary: <expected data / contract>

Steps:
1. Find where data enters <layerB> from <layerA> and where it exits.
2. Compare against the expected contract. Note any drop, mutation, or swallowed error (try/except, sentinel default).
3. Append a row to the evidence file's Boundaries table and return the fields below.

Return EXACTLY this block, nothing else:
- boundary: <layerA> → <layerB>
- data_in: <ok | describe what arrived>   [OBSERVED] <file:line>
- data_out: <ok | describe what left>      [OBSERVED] <file:line>
- verdict: <PASS | BREAK-HERE>
- swallowed_signal: <none | the error/default masking the real failure>
```

### Expected output (example)

```
- boundary: workflow → build-script
- data_in: IDENTITY secret present in workflow env   [OBSERVED] ci.yaml:41
- data_out: IDENTITY absent in build subprocess env  [OBSERVED] build.log:12
- verdict: BREAK-HERE
- swallowed_signal: build.sh line 8 `export IDENTITY=${IDENTITY:-}` — empty default hides the missing secret
```

The main agent takes back five short lines, not the 8k-line CI log the scout read.

---

## Hypothesis-tester (Phase 4)

Dispatch one per candidate hypothesis when ≥2 need log-grep or a trial. Each
tester tries to DISPROVE its hypothesis (elimination, not confirmation) and
reports a matrix verdict.

### Prompt template

```
You are a hypothesis-tester for a triage. Try to DISPROVE exactly ONE hypothesis
with the cheapest decisive check. Do NOT fix anything. Do NOT change logic — read,
grep, and run read-only checks only. Return only the structured fields.

Evidence file (SSoT, append your matrix row here): <path>
Hypothesis to test: H<n>: <one specific, falsifiable cause>
Cheapest disproving check: <the one check that would kill it>
Scope you may read: <files / log / command>   (read-only)

Steps:
1. Run the cheapest check that could disprove H<n>.
2. Mark the evidence: ++ strongly consistent · + weakly · -- inconsistent (disproves) · n/a irrelevant.
3. Append your row to the evidence file's Hypothesis matrix and return the fields below.

Return EXACTLY this block, nothing else:
- hypothesis: H<n>: <cause>
- check_run: <what you actually did>
- evidence: <observed fact>   [OBSERVED] <file:line>
- mark: <++ | + | -- | n/a>
- verdict: <ELIMINATED | SURVIVES | INCONCLUSIVE>
```

### Expected output (example)

```
- hypothesis: H2: request rate-limiting causes the 403s
- check_run: grepped the rate-limit counter in the window of the failures
- evidence: rate_limit_rejections stayed at 0 across all 47 failing requests   [OBSERVED] svc.log:2211
- mark: --
- verdict: ELIMINATED
```

A `--` / ELIMINATED kills the hypothesis. The survivor with the strongest `++` and
no `--` is the leading cause — that is what Phase 5 attributes and routes on.

---

## After the parallel batch returns

- Main agent reads the evidence file (now populated by the subagents), not the subagent transcripts.
- Boundary scouts converge on the ONE `BREAK-HERE` layer → dig there.
- Hypothesis matrix: one survivor → confirmed root cause; multiple survivors → dispatch another round of testers on the cheapest discriminating check; zero survivors → back to Phase 1, the hypothesis set was wrong.
