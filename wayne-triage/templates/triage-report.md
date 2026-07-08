# Triage Report: <slug>

<!--
Handoff artifact. Two uses:
  (1) pipeline-EXTERNAL routes — route-to-owner / escalate-incident / a Jira or
      GitHub comment brief. The receiver does not consume a wayne-checkpoint
      handoff packet, so give them this self-contained markdown.
  (2) the "next prompt" payload inside a wayne-checkpoint handoff packet for a
      pipeline-INTERNAL route.
It is the reader-facing summary distilled FROM the evidence file
(.triage/<date>-<slug>.md); every claim here is already cited there — adds no new
findings. Under two screens.

DURABILITY RULE (§6 especially): the brief may sit for days while the codebase
moves. §2-§4 keep file:line — they are diagnostic evidence, pinned in time. But
§6 (what the next stage should DO) MUST be behavioral: describe interfaces, types,
contracts, and acceptance criteria — NEVER file paths or line numbers, which go
stale. "The SkillConfig type should accept an optional `schedule`", not "edit
line 42 of skill.ts".
-->

**Date:** <date>  ·  **Triaged by:** <you>  ·  **Route:** <fix-now | test-then-fix | iterate-in-a-loop | needs-plan | escalate-architecture | escalate-incident | route-to-owner | UNCERTAIN>  ·  **Next Wayne stage:** <wayne-test-design | wayne-plan | wayne-work | wayne-mind-explode | wayne-ship | — >

## 1. Executive summary

<2-3 sentences: what broke, the confirmed (or UNCERTAIN) root cause, and the one action you're requesting.>

## 2. Symptom

- **Verbatim:** "<exact error / log text>"  (`<file:line>`)
- **Symptom class:** <crash | hang | wrong-output | perf-regression | flaky | config-env>
- **First seen / rate:** <when> / <every time | N of M>

## 3. Reproduction

```
<exact repro command, or "non-deterministic — " + the observed rate and conditions>
```

## 4. Root-cause analysis

- **Cause category:** <logic | config | dependency | environment | infra-hardware | test-artifact | architecture>
- **Confirmed cause:** <statement>  — evidence: `<file:line>`
- **Contributing factors:** <the web of causes, if not singular>
- **Eliminated:** <hypotheses ruled out, and the `--` evidence that killed each>

## 5. Attribution

- **Symptom layer:** <where the symptom pointed>
- **Cause layer:** <where the cause was confirmed>
- **Verdict:** <AGREE → responsible = <component>, confidence <0.0-1.0>  |  DISAGREE → UNCERTAIN, candidates = [<A>, <B>]>

## 6. Recommended next action (durable brief — behavioral, NO file:line)

- **Route:** <the verdict + one line of why it's this, citing the landing field that triggered it (est_lines / blast_radius / failure-count / repro-count)>
- **Desired behavior:** <what the system should do once done — behavioral, specific about edge cases>
- **Key interfaces / contracts:** <types, function signatures, config shapes to change — named, not path-located>
- **Acceptance criteria:** <concrete, independently testable checks — the definition of done>
  - [ ] <criterion 1>
  - [ ] <criterion 2>
- **Out of scope:** <what the next stage must NOT touch — prevents gold-plating>
- **Handoff target:** <owner / iteration-loop eval command / incident channel / follow-up issue>
- **If UNCERTAIN:** <the decision you need from the reader to disambiguate the two candidates>

## 7. Evidence file

`<cwd>/.triage/<date>-<slug>.md` — full symptom / matrix / attribution chain.
